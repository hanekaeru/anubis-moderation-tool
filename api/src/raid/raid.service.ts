import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { RaidIncident } from "@anubis/shared/prisma";
import type { RaidConfigDto, RaidIncidentDto } from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type { UpdateRaidConfigDto } from "./dto/raid.dto";

const DEFAULTS = {
	enabled: false,
	joinThreshold: 10,
	windowSeconds: 30,
	lockdownMinutes: 15,
	alertRoleId: null as string | null,
};

@Injectable()
export class RaidService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	async getConfig(): Promise<RaidConfigDto> {
		const guildId = this.guild.guildId;
		const existing = await this.prisma.raidConfig.findUnique({ where: { guildId } });

		if (!existing) {
			return { guildId, ...DEFAULTS, updatedAt: new Date(0).toISOString() };
		}

		return {
			guildId: existing.guildId,
			enabled: existing.enabled,
			joinThreshold: existing.joinThreshold,
			windowSeconds: existing.windowSeconds,
			lockdownMinutes: existing.lockdownMinutes,
			alertRoleId: existing.alertRoleId,
			updatedAt: existing.updatedAt.toISOString(),
		};
	}

	async updateConfig(dto: UpdateRaidConfigDto, actor: AuthenticatedUser): Promise<RaidConfigDto> {
		const guildId = this.guild.guildId;

		const saved = await this.prisma.raidConfig.upsert({
			where: { guildId },
			update: {
				...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
				...(dto.joinThreshold !== undefined ? { joinThreshold: dto.joinThreshold } : {}),
				...(dto.windowSeconds !== undefined ? { windowSeconds: dto.windowSeconds } : {}),
				...(dto.lockdownMinutes !== undefined ? { lockdownMinutes: dto.lockdownMinutes } : {}),
				...(dto.alertRoleId !== undefined ? { alertRoleId: dto.alertRoleId } : {}),
			},
			create: {
				guildId,
				enabled: dto.enabled ?? DEFAULTS.enabled,
				joinThreshold: dto.joinThreshold ?? DEFAULTS.joinThreshold,
				windowSeconds: dto.windowSeconds ?? DEFAULTS.windowSeconds,
				lockdownMinutes: dto.lockdownMinutes ?? DEFAULTS.lockdownMinutes,
				alertRoleId: dto.alertRoleId ?? DEFAULTS.alertRoleId,
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "raid.config.update",
			entityType: "raid_config",
			entityId: guildId,
			after: { ...dto },
		});

		return {
			guildId: saved.guildId,
			enabled: saved.enabled,
			joinThreshold: saved.joinThreshold,
			windowSeconds: saved.windowSeconds,
			lockdownMinutes: saved.lockdownMinutes,
			alertRoleId: saved.alertRoleId,
			updatedAt: saved.updatedAt.toISOString(),
		};
	}

	private toIncidentDto(row: RaidIncident, resolvedByName: string | null = null): RaidIncidentDto {
		return {
			id: row.id,
			guildId: row.guildId,
			triggeredAt: row.triggeredAt.toISOString(),
			joinCount: row.joinCount,
			windowSeconds: row.windowSeconds,
			memberIds: row.memberIds,
			lockedChannelIds: row.lockedChannelIds,
			resolvedAt: row.resolvedAt?.toISOString() ?? null,
			resolvedBy: resolvedByName,
			active: row.resolvedAt === null,
		};
	}

	async listIncidents(): Promise<RaidIncidentDto[]> {
		const rows = await this.prisma.raidIncident.findMany({
			where: { guildId: this.guild.guildId },
			orderBy: { triggeredAt: "desc" },
			include: { resolvedBy: true },
		});

		return rows.map((row) => this.toIncidentDto(row, row.resolvedBy?.displayName ?? null));
	}

	/** Declenchement manuel depuis la webapp : le bot l'appliquera au prochain passage de synchronisation. */
	async triggerManualLockdown(actor: AuthenticatedUser): Promise<RaidIncidentDto> {
		const guildId = this.guild.guildId;

		const active = await this.prisma.raidIncident.findFirst({
			where: { guildId, resolvedAt: null },
		});
		if (active) {
			throw new ConflictException("Un confinement est deja actif sur ce serveur.");
		}

		const created = await this.prisma.raidIncident.create({
			data: { guildId, joinCount: 0, windowSeconds: 0, memberIds: [], lockedChannelIds: [] },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "raid.lockdown.manual",
			entityType: "raid_incident",
			entityId: created.id,
		});

		return this.toIncidentDto(created);
	}

	/** Leve la resolution en base : le bot revient sur l'effet Discord au prochain passage. */
	async resolve(id: string, actor: AuthenticatedUser): Promise<RaidIncidentDto> {
		const existing = await this.prisma.raidIncident.findFirst({
			where: { id, guildId: this.guild.guildId },
		});
		if (!existing) throw new NotFoundException("Confinement introuvable.");
		if (existing.resolvedAt) return this.toIncidentDto(existing);

		const updated = await this.prisma.raidIncident.update({
			where: { id },
			data: { resolvedAt: new Date(), resolvedById: actor.id, discordSyncedAt: null },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "raid.lockdown.resolve",
			entityType: "raid_incident",
			entityId: id,
		});

		return this.toIncidentDto(updated, actor.displayName);
	}
}
