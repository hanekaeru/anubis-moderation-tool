import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@anubis/shared/prisma";
import type { AccountFlagDto, Paginated } from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { paginate } from "../common/dto/pagination.dto";
import { GuildContextService } from "../common/guild-context.service";
import { toMemberRef } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type { AccountFlagQueryDto } from "./dto/account-flags.dto";

const ACCOUNT_FLAG_INCLUDE = {
	user: true,
	reviewedBy: true,
} satisfies Prisma.AccountFlagInclude;

type AccountFlagRow = Prisma.AccountFlagGetPayload<{ include: typeof ACCOUNT_FLAG_INCLUDE }>;

@Injectable()
export class AccountFlagsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	private toDto(row: AccountFlagRow): AccountFlagDto {
		return {
			id: row.id.toString(),
			guildId: row.guildId,
			member: toMemberRef(row.user),
			type: row.type,
			details: (row.details as Record<string, unknown> | null) ?? null,
			createdAt: row.createdAt.toISOString(),
			reviewedAt: row.reviewedAt?.toISOString() ?? null,
			reviewedBy: row.reviewedBy?.displayName ?? null,
		};
	}

	/** `id` vient de l'URL : une valeur qui n'est pas un entier n'existe pas. */
	private parseId(id: string): bigint {
		if (!/^\d+$/.test(id)) throw new BadRequestException("Identifiant invalide.");
		return BigInt(id);
	}

	async search(query: AccountFlagQueryDto): Promise<Paginated<AccountFlagDto>> {
		const where: Prisma.AccountFlagWhereInput = {
			guildId: this.guild.guildId,
			...(query.userId ? { userId: query.userId } : {}),
			...(query.reviewed === true ? { reviewedAt: { not: null } } : {}),
			...(query.reviewed === false ? { reviewedAt: null } : {}),
		};

		const [rows, total] = await Promise.all([
			this.prisma.accountFlag.findMany({
				where,
				orderBy: { createdAt: "desc" },
				skip: query.skip,
				take: query.take,
				include: ACCOUNT_FLAG_INCLUDE,
			}),
			this.prisma.accountFlag.count({ where }),
		]);

		return paginate(rows.map((row) => this.toDto(row)), total, query);
	}

	async review(id: string, actor: AuthenticatedUser): Promise<AccountFlagDto> {
		const flagId = this.parseId(id);

		const existing = await this.prisma.accountFlag.findFirst({
			where: { id: flagId, guildId: this.guild.guildId },
		});
		if (!existing) throw new NotFoundException("Signalement introuvable.");

		const updated = await this.prisma.accountFlag.update({
			where: { id: flagId },
			data: { reviewedAt: new Date(), reviewedById: actor.id },
			include: ACCOUNT_FLAG_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "account-flag.review",
			entityType: "account_flag",
			entityId: id,
		});

		return this.toDto(updated);
	}
}
