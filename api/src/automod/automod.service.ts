import { Injectable } from "@nestjs/common";
import type { AutomodRule, Prisma } from "@anubis/shared/prisma";
import {
	AutomodAction,
	AutomodRuleType,
	DEFAULT_AUTOMOD_SETTINGS,
	type AutomodIncidentDto,
	type AutomodRuleDto,
	type AutomodRuleSettings,
	type Paginated,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { paginate } from "../common/dto/pagination.dto";
import { GuildContextService } from "../common/guild-context.service";
import { toMemberRef } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type { AutomodIncidentQueryDto, UpdateAutomodRuleDto } from "./dto/automod.dto";

@Injectable()
export class AutomodService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	private toDto(row: AutomodRule): AutomodRuleDto {
		return {
			id: row.id,
			guildId: row.guildId,
			type: row.type,
			enabled: row.enabled,
			action: row.action,
			timeoutSeconds: row.timeoutSeconds,
			settings: row.settings as unknown as AutomodRuleSettings,
			exemptRoleIds: row.exemptRoleIds,
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	/** Virtuelle : une regle jamais enregistree, affichee avec ses valeurs par defaut. */
	private defaultDto(type: AutomodRuleType): AutomodRuleDto {
		return {
			id: "",
			guildId: this.guild.guildId,
			type,
			enabled: false,
			action: AutomodAction.LOG_ONLY,
			timeoutSeconds: null,
			settings: DEFAULT_AUTOMOD_SETTINGS[type],
			exemptRoleIds: [],
			updatedAt: new Date(0).toISOString(),
		};
	}

	/** Une ligne par type de regle, cree paresseusement au premier enregistrement. */
	async listRules(): Promise<AutomodRuleDto[]> {
		const rows = await this.prisma.automodRule.findMany({
			where: { guildId: this.guild.guildId },
		});
		const byType = new Map(rows.map((row) => [row.type, row]));

		return Object.values(AutomodRuleType).map(
			(type) => (byType.has(type) ? this.toDto(byType.get(type)!) : this.defaultDto(type)),
		);
	}

	async upsertRule(
		type: AutomodRuleType,
		dto: UpdateAutomodRuleDto,
		actor: AuthenticatedUser,
	): Promise<AutomodRuleDto> {
		const guildId = this.guild.guildId;

		const existing = await this.prisma.automodRule.findUnique({
			where: { guildId_type: { guildId, type } },
		});

		const saved = await this.prisma.automodRule.upsert({
			where: { guildId_type: { guildId, type } },
			update: {
				...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
				...(dto.action !== undefined ? { action: dto.action } : {}),
				...(dto.timeoutSeconds !== undefined ? { timeoutSeconds: dto.timeoutSeconds } : {}),
				...(dto.settings !== undefined
					? { settings: dto.settings as Prisma.InputJsonValue }
					: {}),
				...(dto.exemptRoleIds !== undefined ? { exemptRoleIds: dto.exemptRoleIds } : {}),
				updatedById: actor.id,
			},
			create: {
				guildId,
				type,
				enabled: dto.enabled ?? false,
				action: dto.action ?? AutomodAction.LOG_ONLY,
				timeoutSeconds: dto.timeoutSeconds ?? null,
				settings: (dto.settings ?? DEFAULT_AUTOMOD_SETTINGS[type]) as Prisma.InputJsonValue,
				exemptRoleIds: dto.exemptRoleIds ?? [],
				updatedById: actor.id,
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "automod.rule.update",
			entityType: "automod_rule",
			entityId: saved.id,
			before: existing
				? { enabled: existing.enabled, action: existing.action }
				: undefined,
			after: { enabled: saved.enabled, action: saved.action },
		});

		return this.toDto(saved);
	}

	async listIncidents(query: AutomodIncidentQueryDto): Promise<Paginated<AutomodIncidentDto>> {
		const where: Prisma.AutomodIncidentWhereInput = {
			guildId: this.guild.guildId,
			...(query.ruleType ? { ruleType: query.ruleType } : {}),
			...(query.userId ? { userId: query.userId } : {}),
		};

		const [rows, total] = await Promise.all([
			this.prisma.automodIncident.findMany({
				where,
				orderBy: { occurredAt: "desc" },
				skip: query.skip,
				take: query.take,
				include: { user: true },
			}),
			this.prisma.automodIncident.count({ where }),
		]);

		const items: AutomodIncidentDto[] = rows.map((row) => ({
			id: row.id.toString(),
			guildId: row.guildId,
			ruleType: row.ruleType,
			member: toMemberRef(row.user),
			channelId: row.channelId,
			action: row.action,
			messageContent: row.messageContent,
			messageAttachments:
				(row.messageAttachments as unknown as AutomodIncidentDto["messageAttachments"]) ?? [],
			details: (row.details as Record<string, unknown> | null) ?? null,
			occurredAt: row.occurredAt.toISOString(),
		}));

		return paginate(items, total, query);
	}
}
