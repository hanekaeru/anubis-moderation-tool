import { Injectable } from "@nestjs/common";
import {
	DEFAULT_MODERATION_POINTS,
	type ModerationPointsConfigDto,
	type SanctionType,
	type WarningSeverity,
} from "@anubis/shared";
import type { ModerationPointsConfig } from "@anubis/shared/prisma";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type { UpdateModerationPointsDto } from "./dto/moderation.dto";

/**
 * Bareme de points de moderation.
 *
 * La base range le bareme en colonnes nommees (`timeout_points`,
 * `warning_low_points`...) parce que le jeu de cles est ferme et connu du
 * schema. L'API, elle, l'expose en dictionnaires indexes par l'enum : le
 * formulaire du dashboard et le calcul du score s'ecrivent alors sans switch,
 * et ajouter un type de sanction ne casse pas la lecture. La traduction entre
 * les deux formes vit ici, et nulle part ailleurs.
 */
@Injectable()
export class ModerationPointsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	private static toDto(
		guildId: string,
		row: ModerationPointsConfig | null,
	): ModerationPointsConfigDto {
		if (!row) {
			return {
				guildId,
				...DEFAULT_MODERATION_POINTS,
				// Epoch plutot que « maintenant » : rien n'a jamais ete regle, et
				// afficher la date du jour laisserait croire le contraire.
				updatedAt: new Date(0).toISOString(),
			};
		}

		return {
			guildId: row.guildId,
			warningPoints: {
				LOW: row.warningLowPoints,
				MEDIUM: row.warningMediumPoints,
				HIGH: row.warningHighPoints,
			},
			sanctionPoints: {
				TIMEOUT: row.timeoutPoints,
				KICK: row.kickPoints,
				BAN: row.banPoints,
				SHADOWBAN: row.shadowbanPoints,
			},
			warnThreshold: row.warnThreshold,
			criticalThreshold: row.criticalThreshold,
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	async getConfig(): Promise<ModerationPointsConfigDto> {
		const guildId = this.guild.guildId;
		const row = await this.prisma.moderationPointsConfig.findUnique({
			where: { guildId },
		});
		return ModerationPointsService.toDto(guildId, row);
	}

	/** Points par defaut d'une sanction de ce type. */
	async pointsForSanction(type: SanctionType): Promise<number> {
		const config = await this.getConfig();
		return config.sanctionPoints[type];
	}

	/** Points par defaut d'un avertissement de cette gravite. */
	async pointsForWarning(severity: WarningSeverity): Promise<number> {
		const config = await this.getConfig();
		return config.warningPoints[severity];
	}

	async updateConfig(
		dto: UpdateModerationPointsDto,
		actor: AuthenticatedUser,
	): Promise<ModerationPointsConfigDto> {
		const guildId = this.guild.guildId;
		const actuel = await this.getConfig();

		// Un champ absent garde sa valeur : le formulaire peut n'envoyer que ce
		// que l'utilisateur a touche.
		const fusion = {
			warningLowPoints: dto.warningPoints?.LOW ?? actuel.warningPoints.LOW,
			warningMediumPoints:
				dto.warningPoints?.MEDIUM ?? actuel.warningPoints.MEDIUM,
			warningHighPoints: dto.warningPoints?.HIGH ?? actuel.warningPoints.HIGH,
			timeoutPoints: dto.sanctionPoints?.TIMEOUT ?? actuel.sanctionPoints.TIMEOUT,
			kickPoints: dto.sanctionPoints?.KICK ?? actuel.sanctionPoints.KICK,
			banPoints: dto.sanctionPoints?.BAN ?? actuel.sanctionPoints.BAN,
			shadowbanPoints:
				dto.sanctionPoints?.SHADOWBAN ?? actuel.sanctionPoints.SHADOWBAN,
			warnThreshold: dto.warnThreshold ?? actuel.warnThreshold,
			criticalThreshold: dto.criticalThreshold ?? actuel.criticalThreshold,
		};

		const saved = await this.prisma.moderationPointsConfig.upsert({
			where: { guildId },
			update: fusion,
			create: { guildId, ...fusion },
		});

		// Le journal enregistre le bareme *resolu*, pas le corps de la requete :
		// un formulaire qui n'envoie que les champs touches laisserait sinon une
		// entree illisible, ou l'on ne saurait pas ce qui n'a pas bouge.
		await this.audit.record({
			appUserId: actor.id,
			action: "moderation.points.update",
			entityType: "moderation_points_config",
			entityId: guildId,
			before: {
				warningPoints: actuel.warningPoints,
				sanctionPoints: actuel.sanctionPoints,
				warnThreshold: actuel.warnThreshold,
				criticalThreshold: actuel.criticalThreshold,
			},
			after: fusion,
		});

		return ModerationPointsService.toDto(guildId, saved);
	}
}
