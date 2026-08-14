import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { Prisma } from "@anubis/shared/prisma";
import {
	INSTANT_SANCTION_TYPES,
	MAX_TIMEOUT_SECONDS,
	SANCTION_TYPE_LABELS,
	type Paginated,
	type SanctionDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { paginate } from "../common/dto/pagination.dto";
import { GuildContextService } from "../common/guild-context.service";
import { toActorRef, toMemberRef } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type {
	CreateSanctionDto,
	RevokeDto,
	SanctionQueryDto,
} from "./dto/moderation.dto";

const SANCTION_INCLUDE = {
	user: true,
	moderator: true,
	createdBy: true,
	revokedBy: true,
} satisfies Prisma.SanctionInclude;

type SanctionRow = Prisma.SanctionGetPayload<{
	include: typeof SANCTION_INCLUDE;
}>;

@Injectable()
export class SanctionsService {
	private readonly logger = new Logger(SanctionsService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) { }

	private toDto(row: SanctionRow): SanctionDto {
		return {
			id: row.id,
			guildId: row.guildId,
			member: toMemberRef(row.user),
			issuedBy: toActorRef(row.moderator, row.createdBy),
			type: row.type,
			status: row.status,
			reason: row.reason,
			durationSeconds: row.durationSeconds,
			startsAt: row.startsAt.toISOString(),
			expiresAt: row.expiresAt?.toISOString() ?? null,
			revokedAt: row.revokedAt?.toISOString() ?? null,
			revokedBy: row.revokedBy ? toActorRef(null, row.revokedBy) : null,
			revokeReason: row.revokeReason,
			warningId: row.warningId,
			evidenceUrl: row.evidenceUrl,
			createdAt: row.createdAt.toISOString(),
		};
	}

	async search(query: SanctionQueryDto): Promise<Paginated<SanctionDto>> {
		const where: Prisma.SanctionWhereInput = {
			guildId: this.guild.guildId,
			...(query.userId ? { userId: query.userId } : {}),
			...(query.type ? { type: query.type } : {}),
			...(query.status ? { status: query.status } : {}),
			...(query.from || query.to
				? {
					createdAt: {
						...(query.from
							? { gte: new Date(query.from) }
							: {}),
						...(query.to ? { lte: new Date(query.to) } : {}),
					},
				}
				: {}),
		};

		const [rows, total] = await Promise.all([
			this.prisma.sanction.findMany({
				where,
				orderBy: { createdAt: "desc" },
				skip: query.skip,
				take: query.take,
				include: SANCTION_INCLUDE,
			}),
			this.prisma.sanction.count({ where }),
		]);

		return paginate(
			rows.map((row) => this.toDto(row)),
			total,
			query,
		);
	}

	async findOne(id: string): Promise<SanctionDto> {
		const row = await this.prisma.sanction.findFirst({
			where: { id, guildId: this.guild.guildId },
			include: SANCTION_INCLUDE,
		});

		if (!row) throw new NotFoundException("Sanction introuvable.");
		return this.toDto(row);
	}

	/**
	 * Verifie la coherence duree / type.
	 *
	 * Ces regles viennent de Discord, pas d'un choix produit : une expulsion n'a
	 * pas de duree, et une exclusion temporaire ne peut pas depasser 28 jours.
	 * Les laisser passer creerait une sanction que le bot ne saura pas appliquer.
	 */
	private validateDuration(dto: CreateSanctionDto): number | null {
		const isInstant = INSTANT_SANCTION_TYPES.includes(dto.type);

		if (isInstant) {
			if (dto.durationSeconds) {
				throw new BadRequestException(
					`Une sanction de type "${SANCTION_TYPE_LABELS[dto.type]}" ne prend pas de duree.`,
				);
			}
			return null;
		}

		if (dto.type === "TIMEOUT") {
			if (!dto.durationSeconds) {
				throw new BadRequestException(
					"Une exclusion temporaire doit avoir une duree.",
				);
			}
			if (dto.durationSeconds > MAX_TIMEOUT_SECONDS) {
				throw new BadRequestException(
					"Discord limite les exclusions temporaires a 28 jours.",
				);
			}
		}

		return dto.durationSeconds ?? null;
	}

	async create(
		dto: CreateSanctionDto,
		actor: AuthenticatedUser,
	): Promise<SanctionDto> {
		const guildId = this.guild.guildId;
		const durationSeconds = this.validateDuration(dto);

		const member = await this.prisma.member.findUnique({
			where: { guildId_userId: { guildId, userId: dto.userId } },
		});

		if (!member) {
			throw new NotFoundException(
				`Membre ${dto.userId} inconnu sur ce serveur. Le bot doit l avoir enregistre au prealable.`,
			);
		}

		if (dto.warningId) {
			const warning = await this.prisma.warning.findFirst({
				where: { id: dto.warningId, guildId, userId: dto.userId },
			});
			if (!warning) {
				throw new BadRequestException(
					"L avertissement lie n existe pas ou ne concerne pas ce membre.",
				);
			}
		}

		const startsAt = new Date();
		const created = await this.prisma.sanction.create({
			data: {
				guildId,
				userId: dto.userId,
				createdById: actor.id,
				type: dto.type,
				reason: dto.reason,
				durationSeconds,
				startsAt,
				expiresAt: durationSeconds
					? new Date(startsAt.getTime() + durationSeconds * 1000)
					: null,
				// Une expulsion prend effet et se termine dans la foulee : la laisser
				// ACTIVE la ferait apparaitre indefiniment comme sanction en cours.
				status: INSTANT_SANCTION_TYPES.includes(dto.type)
					? "EXPIRED"
					: "ACTIVE",
				warningId: dto.warningId ?? null,
				evidenceUrl: dto.evidenceUrl ?? null,
				isApplied: dto.isApplied ?? undefined
			},
			include: SANCTION_INCLUDE,
		});

		await this.prisma.moderationActivity.create({
			data: {
				guildId,
				appUserId: actor.id,
				action: `sanction.${dto.type.toLowerCase()}`,
				targetUserId: dto.userId,
				targetType: "sanction",
				targetId: created.id,
				metadata: { type: dto.type, durationSeconds },
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "sanction.create",
			entityType: "sanction",
			entityId: created.id,
			after: { userId: dto.userId, type: dto.type, reason: dto.reason },
		});

		return this.toDto(created);
	}

	async revoke(
		id: string,
		dto: RevokeDto,
		actor: AuthenticatedUser,
	): Promise<SanctionDto> {
		const existing = await this.prisma.sanction.findFirst({
			where: { id, guildId: this.guild.guildId },
		});

		if (!existing) throw new NotFoundException("Sanction introuvable.");
		if (existing.status === "REVOKED") {
			throw new BadRequestException("Cette sanction est deja levee.");
		}
		// Une sanction EXPIRED n'a plus d'effet cote Discord a lever (expulsion
		// deja executee, timeout ou shadowban deja arrive a echeance) : marquer
		// "levee" ne changerait rien reellement, et le bot n'a de toute facon
		// aucun effet a rejouer pour ce statut.
		if (existing.status === "EXPIRED") {
			throw new BadRequestException(
				"Cette sanction est deja terminee, elle ne peut pas etre levee.",
			);
		}

		const updated = await this.prisma.sanction.update({
			where: { id },
			data: {
				status: "REVOKED",
				revokedAt: new Date(),
				revokedById: actor.id,
				revokeReason: dto.reason,
			},
			include: SANCTION_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "sanction.revoke",
			entityType: "sanction",
			entityId: id,
			before: { status: existing.status },
			after: { status: "REVOKED", reason: dto.reason },
		});

		return this.toDto(updated);
	}

	/**
	 * Bascule les sanctions arrivees a terme en EXPIRED.
	 *
	 * Le statut pourrait se deduire de `expiresAt` a la lecture, mais le stocker
	 * permet de filtrer et de compter en base sans recalculer partout.
	 */
	@Cron(CronExpression.EVERY_MINUTE)
	async expireOutdatedSanctions(): Promise<void> {
		const { count } = await this.prisma.sanction.updateMany({
			where: {
				status: "ACTIVE",
				expiresAt: { not: null, lte: new Date() },
			},
			data: { status: "EXPIRED" },
		});

		if (count > 0) {
			this.logger.log(`${count} sanction(s) arrivee(s) a expiration.`);
		}
	}
}
