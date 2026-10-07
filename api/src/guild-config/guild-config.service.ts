import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import type { ConfigGuild } from "@anubis/shared/prisma";
import {
	DEFAULT_MENTION_MEMBERS,
	GUILD_ROLE_DESCRIPTIONS,
	GUILD_ROLE_LABELS,
	GuildRoleKey,
	MentionSettingKey,
	isSnowflake,
	type GuildConfigDto,
	type MentionSettingsDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types";
import { GuildContextService } from "../common/guild-context.service";
import { PrismaService } from "../prisma/prisma.service";
import type {
	CreateGuildConfigDto,
	UpdateGuildConfigDto,
	UpdateMentionSettingsDto,
} from "./dto/guild-config.dto";

@Injectable()
export class GuildConfigService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	private toDto(row: ConfigGuild): GuildConfigDto {
		return {
			id: row.id.toString(),
			guildId: row.guildId,
			configName: row.configName,
			configValue: row.configValue,
			configDescription: row.configDescription,
		};
	}

	/** `id` vient de l'URL : une valeur qui n'est pas un entier n'existe pas. */
	private parseId(id: string): bigint {
		if (!/^\d+$/.test(id)) {
			throw new BadRequestException("Identifiant invalide.");
		}
		return BigInt(id);
	}

	async list(): Promise<GuildConfigDto[]> {
		const rows = await this.prisma.configGuild.findMany({
			where: { guildId: this.guild.guildId },
			orderBy: { configName: "asc" },
		});

		return rows.map((row) => this.toDto(row));
	}

	async create(
		dto: CreateGuildConfigDto,
		actor: AuthenticatedUser,
	): Promise<GuildConfigDto> {
		const guildId = this.guild.guildId;

		const existing = await this.prisma.configGuild.findUnique({
			where: {
				guildId_configName: { guildId, configName: dto.configName },
			},
		});

		if (existing) {
			throw new ConflictException(
				`Une configuration "${dto.configName}" existe déjà pour ce serveur.`,
			);
		}

		const created = await this.prisma.configGuild.create({
			data: {
				guildId,
				configName: dto.configName,
				configValue: dto.configValue,
				configDescription: dto.configDescription,
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "guildconfig.create",
			entityType: "config_guild",
			entityId: created.id.toString(),
			after: { configName: dto.configName, configValue: dto.configValue },
		});

		return this.toDto(created);
	}

	private async loadTarget(id: bigint): Promise<ConfigGuild> {
		const row = await this.prisma.configGuild.findFirst({
			where: { id, guildId: this.guild.guildId },
		});

		if (!row) throw new NotFoundException("Configuration introuvable.");
		return row;
	}

	async update(
		id: string,
		dto: UpdateGuildConfigDto,
		actor: AuthenticatedUser,
	): Promise<GuildConfigDto> {
		const target = await this.loadTarget(this.parseId(id));

		const updated = await this.prisma.configGuild.update({
			where: { id: target.id },
			data: {
				...(dto.configValue !== undefined
					? { configValue: dto.configValue }
					: {}),
				...(dto.configDescription !== undefined
					? { configDescription: dto.configDescription }
					: {}),
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "guildconfig.update",
			entityType: "config_guild",
			entityId: target.id.toString(),
			before: { configValue: target.configValue },
			after: { ...dto },
		});

		return this.toDto(updated);
	}

	/**
	 * Reglages de mention, relus depuis les cles de `config_guild`.
	 *
	 * Une cle absente n'est pas une erreur : elle signifie « ce role n'est pas
	 * declare » et, pour `LOG_MENTION_MEMBERS`, le defaut partage avec le bot.
	 */
	async getMentionSettings(): Promise<MentionSettingsDto> {
		const noms: string[] = [
			...Object.values(GuildRoleKey),
			MentionSettingKey.ALERT_ROLE,
			MentionSettingKey.LOG_MEMBERS,
		];

		const rows = await this.prisma.configGuild.findMany({
			where: { guildId: this.guild.guildId, configName: { in: noms } },
		});
		const valeurs = new Map(rows.map((row) => [row.configName, row.configValue]));

		const roles = Object.fromEntries(
			Object.values(GuildRoleKey).map((cle) => [cle, valeurs.get(cle) ?? null]),
		) as Record<GuildRoleKey, string | null>;

		const alertRoleKey = valeurs.get(MentionSettingKey.ALERT_ROLE) ?? null;

		return {
			roles,
			alertRoleKey: this.asRoleKey(alertRoleKey),
			mentionMembers:
				valeurs.get(MentionSettingKey.LOG_MEMBERS) === undefined
					? DEFAULT_MENTION_MEMBERS
					: valeurs.get(MentionSettingKey.LOG_MEMBERS) === "true",
		};
	}

	/** `null` pour une cle inconnue : la table reste modifiable a la main. */
	private asRoleKey(value: string | null): GuildRoleKey | null {
		const connues: string[] = Object.values(GuildRoleKey);
		return value && connues.includes(value) ? (value as GuildRoleKey) : null;
	}

	async updateMentionSettings(
		dto: UpdateMentionSettingsDto,
		actor: AuthenticatedUser,
	): Promise<MentionSettingsDto> {
		const avant = await this.getMentionSettings();

		const roles = {} as Record<GuildRoleKey, string | null>;
		for (const cle of Object.values(GuildRoleKey)) {
			const brut = dto.roles[cle];
			const valeur = typeof brut === "string" ? brut.trim() : null;

			if (valeur && !isSnowflake(valeur)) {
				throw new BadRequestException(
					`« ${GUILD_ROLE_LABELS[cle]} » : « ${valeur} » n'est pas un identifiant de rôle Discord.`,
				);
			}

			roles[cle] = valeur || null;
		}

		// Meme exigence que le salon dedie des annonces d'experience : un reglage
		// qui designe quelque chose d'absent ne se laisse pas enregistrer. Sinon
		// l'ouverture d'un ticket n'interpellerait personne, sans rien dire.
		if (dto.alertRoleKey && !roles[dto.alertRoleKey]) {
			throw new BadRequestException(
				`Renseigne d'abord l'identifiant du rôle « ${GUILD_ROLE_LABELS[dto.alertRoleKey]} » pour pouvoir le mentionner.`,
			);
		}

		const aEcrire: [string, string | null, string][] = [
			...Object.values(GuildRoleKey).map(
				(cle) =>
					[cle, roles[cle], GUILD_ROLE_DESCRIPTIONS[cle]] as [
						string,
						string | null,
						string,
					],
			),
			[
				MentionSettingKey.ALERT_ROLE,
				dto.alertRoleKey,
				"Rôle mentionné à l'ouverture d'un ticket.",
			],
			[
				MentionSettingKey.LOG_MEMBERS,
				String(dto.mentionMembers),
				"Mentionner les membres dans les journaux plutôt que d'écrire leur pseudo.",
			],
		];

		const guildId = this.guild.guildId;

		await this.prisma.$transaction(
			aEcrire.map(([configName, configValue, configDescription]) =>
				// Une valeur vide efface la ligne : c'est le seul moyen de retirer
				// un role declare, et laisser une chaine vide en base ferait croire
				// a un reglage pose.
				configValue === null
					? this.prisma.configGuild.deleteMany({ where: { guildId, configName } })
					: this.prisma.configGuild.upsert({
							where: { guildId_configName: { guildId, configName } },
							update: { configValue, configDescription },
							create: { guildId, configName, configValue, configDescription },
						}),
			),
		);

		await this.audit.record({
			appUserId: actor.id,
			action: "guildconfig.mentions",
			entityType: "config_guild",
			entityId: guildId,
			before: { ...avant },
			after: {
				roles,
				alertRoleKey: dto.alertRoleKey,
				mentionMembers: dto.mentionMembers,
			},
		});

		return this.getMentionSettings();
	}

	async remove(id: string, actor: AuthenticatedUser): Promise<void> {
		const target = await this.loadTarget(this.parseId(id));

		await this.prisma.configGuild.delete({ where: { id: target.id } });

		await this.audit.record({
			appUserId: actor.id,
			action: "guildconfig.delete",
			entityType: "config_guild",
			entityId: target.id.toString(),
			before: {
				configName: target.configName,
				configValue: target.configValue,
			},
		});
	}
}
