import { Injectable, NotFoundException } from "@nestjs/common";
import {
	DEFAULT_QUARANTINE_BUTTON_LABEL,
	type QuarantineConfigDto,
	type QuarantineStatusDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type { UpdateQuarantineConfigDto } from "./dto/quarantine.dto";

const DEFAULTS = {
	enabled: false,
	roleId: null as string | null,
	channelId: null as string | null,
	message: null as string | null,
	buttonLabel: DEFAULT_QUARANTINE_BUTTON_LABEL,
};

/** Ligne de `quarantine_status` avec ce qu'il faut pour l'afficher. */
type StatusRow = {
	guildId: string;
	userId: string;
	quarantinedAt: Date;
	acceptedAt: Date | null;
	discordSyncedAt: Date | null;
	user: { username: string; globalName: string | null; avatarUrl: string | null };
	releasedBy: { displayName: string } | null;
};

@Injectable()
export class QuarantineService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	async getConfig(): Promise<QuarantineConfigDto> {
		const guildId = this.guild.guildId;
		const existing = await this.prisma.quarantineConfig.findUnique({
			where: { guildId },
		});

		if (!existing) {
			return { guildId, ...DEFAULTS, updatedAt: new Date(0).toISOString() };
		}

		return {
			guildId: existing.guildId,
			enabled: existing.enabled,
			roleId: existing.roleId,
			channelId: existing.channelId,
			message: existing.message,
			buttonLabel: existing.buttonLabel,
			updatedAt: existing.updatedAt.toISOString(),
		};
	}

	async updateConfig(
		dto: UpdateQuarantineConfigDto,
		actor: AuthenticatedUser,
	): Promise<QuarantineConfigDto> {
		const guildId = this.guild.guildId;

		const saved = await this.prisma.quarantineConfig.upsert({
			where: { guildId },
			update: {
				...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
				...(dto.roleId !== undefined ? { roleId: dto.roleId } : {}),
				...(dto.channelId !== undefined ? { channelId: dto.channelId } : {}),
				...(dto.message !== undefined ? { message: dto.message } : {}),
				...(dto.buttonLabel !== undefined ? { buttonLabel: dto.buttonLabel } : {}),
			},
			create: {
				guildId,
				enabled: dto.enabled ?? DEFAULTS.enabled,
				roleId: dto.roleId ?? DEFAULTS.roleId,
				channelId: dto.channelId ?? DEFAULTS.channelId,
				message: dto.message ?? DEFAULTS.message,
				buttonLabel: dto.buttonLabel ?? DEFAULTS.buttonLabel,
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "quarantine.config.update",
			entityType: "quarantine_config",
			entityId: guildId,
			after: { ...dto },
		});

		return {
			guildId: saved.guildId,
			enabled: saved.enabled,
			roleId: saved.roleId,
			channelId: saved.channelId,
			message: saved.message,
			buttonLabel: saved.buttonLabel,
			updatedAt: saved.updatedAt.toISOString(),
		};
	}

	private toStatusDto(row: StatusRow): QuarantineStatusDto {
		return {
			guildId: row.guildId,
			userId: row.userId,
			username: row.user.username,
			displayName: row.user.globalName,
			avatarUrl: row.user.avatarUrl,
			quarantinedAt: row.quarantinedAt.toISOString(),
			acceptedAt: row.acceptedAt?.toISOString() ?? null,
			releasedBy: row.releasedBy?.displayName ?? null,
			active: row.acceptedAt === null,
			pendingSync: row.acceptedAt !== null && row.discordSyncedAt === null,
		};
	}

	/**
	 * Membres actuellement bloques, du plus ancien au plus recent : c'est celui
	 * qui attend depuis le plus longtemps qui merite l'attention du staff.
	 */
	async listActive(): Promise<QuarantineStatusDto[]> {
		const rows = await this.prisma.quarantineStatus.findMany({
			where: { guildId: this.guild.guildId, acceptedAt: null },
			orderBy: { quarantinedAt: "asc" },
			include: { user: true, releasedBy: true },
		});

		return rows.map((row) => this.toStatusDto(row));
	}

	/**
	 * Levee manuelle depuis la webapp.
	 *
	 * `discordSyncedAt` reste a `null` : le retrait du role revient au bot, au
	 * prochain passage de sa tache de synchronisation. Idempotent, comme
	 * `RaidService.resolve` — relever une quarantaine deja levee ne doit pas
	 * echouer ni reprogrammer un retrait de role.
	 */
	async release(
		userId: string,
		actor: AuthenticatedUser,
	): Promise<QuarantineStatusDto> {
		const guildId = this.guild.guildId;
		const existing = await this.prisma.quarantineStatus.findUnique({
			where: { guildId_userId: { guildId, userId } },
			include: { user: true, releasedBy: true },
		});

		if (!existing) throw new NotFoundException("Membre non mis en quarantaine.");
		if (existing.acceptedAt) return this.toStatusDto(existing);

		const updated = await this.prisma.quarantineStatus.update({
			where: { guildId_userId: { guildId, userId } },
			data: {
				acceptedAt: new Date(),
				releasedById: actor.id,
				discordSyncedAt: null,
			},
			include: { user: true, releasedBy: true },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "quarantine.release",
			entityType: "quarantine_status",
			entityId: userId,
		});

		return this.toStatusDto(updated);
	}
}
