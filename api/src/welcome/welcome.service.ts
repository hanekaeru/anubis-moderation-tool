import { BadRequestException, Injectable } from "@nestjs/common";
import type { WelcomeConfig } from "@anubis/shared/prisma";
import { GuildRoleKey, MentionSettingKey, type WelcomeConfigDto } from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type { UpdateWelcomeConfigDto } from "./dto/welcome.dto";

/** Doivent rester identiques aux `@default` de `WelcomeConfig`. */
const DEFAULTS = {
	channelId: null as string | null,
	joinEnabled: false,
	joinMessage: null as string | null,
	leaveEnabled: false,
	leaveMessage: null as string | null,
	boostEnabled: false,
	boostChannelId: null as string | null,
	boostMessage: null as string | null,
};

const CHAMPS = Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[];

/** Champs de texte : une chaine vide vaut « texte par defaut », pas un message vide. */
const MESSAGES = ["joinMessage", "leaveMessage", "boostMessage"] as const;

@Injectable()
export class WelcomeService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	async getConfig(): Promise<WelcomeConfigDto> {
		const guildId = this.guild.guildId;
		const [row, alertRoleId] = await Promise.all([
			this.prisma.welcomeConfig.findUnique({ where: { guildId } }),
			this.alertRoleId(),
		]);
		return this.toDto(guildId, row, alertRoleId);
	}

	/**
	 * Enregistre les reglages.
	 *
	 * Un message active sans salon ou l'envoyer est refuse, meme exigence que le
	 * salon dedie des annonces d'experience : un reglage qui ne peut rien
	 * produire ne doit pas pouvoir s'afficher comme actif.
	 */
	async updateConfig(
		dto: UpdateWelcomeConfigDto,
		actor: AuthenticatedUser,
	): Promise<WelcomeConfigDto> {
		const guildId = this.guild.guildId;
		const existing = await this.prisma.welcomeConfig.findUnique({ where: { guildId } });

		const data: Record<string, unknown> = {};
		for (const champ of CHAMPS) {
			const valeur = (dto as Record<string, unknown>)[champ];
			if (valeur === undefined) continue;
			data[champ] =
				(MESSAGES as readonly string[]).includes(champ) &&
				typeof valeur === "string" &&
				!valeur.trim()
					? null
					: valeur;
		}

		const resultat = { ...DEFAULTS, ...(existing ?? {}), ...data };

		if ((resultat.joinEnabled || resultat.leaveEnabled) && !resultat.channelId) {
			throw new BadRequestException(
				"Choisissez le salon des arrivées et des départs avant d'activer ces messages.",
			);
		}
		if (resultat.boostEnabled && !resultat.boostChannelId && !resultat.channelId) {
			throw new BadRequestException(
				"Choisissez un salon pour les annonces de boost avant de les activer.",
			);
		}

		const saved = await this.prisma.welcomeConfig.upsert({
			where: { guildId },
			update: data,
			create: { guildId, ...DEFAULTS, ...data },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "welcome.config.update",
			entityType: "welcome_config",
			entityId: guildId,
			before: existing ? this.instantane(existing) : undefined,
			after: this.instantane(saved),
		});

		return this.toDto(guildId, saved, await this.alertRoleId());
	}

	private instantane(row: WelcomeConfig): typeof DEFAULTS {
		return Object.fromEntries(
			CHAMPS.map((champ) => [champ, row[champ]]),
		) as typeof DEFAULTS;
	}

	private toDto(
		guildId: string,
		row: WelcomeConfig | null,
		alertRoleId: string | null,
	): WelcomeConfigDto {
		const valeurs = row ? this.instantane(row) : DEFAULTS;
		return {
			guildId,
			...valeurs,
			alertRoleId,
			updatedAt: row?.updatedAt.toISOString() ?? null,
		};
	}

	/**
	 * Role interpelle par `{moderation}` : celui choisi dans « Rôles & mentions »,
	 * relu comme le fait le bot. Une cle inconnue vaut « aucun role ».
	 */
	private async alertRoleId(): Promise<string | null> {
		const guildId = this.guild.guildId;
		const cle = await this.prisma.configGuild.findUnique({
			where: {
				guildId_configName: { guildId, configName: MentionSettingKey.ALERT_ROLE },
			},
		});

		const connues: string[] = Object.values(GuildRoleKey);
		if (!cle || !connues.includes(cle.configValue)) return null;

		const role = await this.prisma.configGuild.findUnique({
			where: { guildId_configName: { guildId, configName: cle.configValue } },
		});
		return role?.configValue ?? null;
	}
}
