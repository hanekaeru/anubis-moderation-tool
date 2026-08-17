import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@anubis/shared/prisma";
import type { Paginated, WarningDto } from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { paginate } from "../common/dto/pagination.dto";
import { GuildContextService } from "../common/guild-context.service";
import { toActorRef, toAttachmentRef, toMemberRef } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import { memberSearchFilter } from "./member-filter";
import { ModerationPointsService } from "./moderation-points.service";
import type {
	CreateWarningDto,
	RevokeDto,
	WarningQueryDto,
} from "./dto/moderation.dto";

/** Jointures necessaires pour construire un WarningDto complet. */
const WARNING_INCLUDE = {
	user: true,
	moderator: true,
	createdBy: true,
	revokedBy: true,
	// Metadonnees seulement : `data` est exclu, sinon chaque liste
	// d'avertissements transporterait les octets de toutes les preuves.
	attachments: {
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			fileName: true,
			contentType: true,
			size: true,
			spoiler: true,
			createdAt: true,
			uploadedBy: true,
			uploadedByDiscord: true,
		},
	},
} satisfies Prisma.WarningInclude;

type WarningRow = Prisma.WarningGetPayload<{ include: typeof WARNING_INCLUDE }>;

@Injectable()
export class WarningsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
		private readonly pointsConfig: ModerationPointsService,
	) {}

	private toDto(row: WarningRow): WarningDto {
		const expired =
			row.expiresAt !== null && row.expiresAt.getTime() <= Date.now();

		return {
			id: row.id,
			guildId: row.guildId,
			member: toMemberRef(row.user),
			issuedBy: toActorRef(row.moderator, row.createdBy),
			reason: row.reason,
			severity: row.severity,
			points: row.points,
			expiresAt: row.expiresAt?.toISOString() ?? null,
			revokedAt: row.revokedAt?.toISOString() ?? null,
			revokedBy: row.revokedBy ? toActorRef(null, row.revokedBy) : null,
			revokeReason: row.revokeReason,
			createdAt: row.createdAt.toISOString(),
			isActive: row.revokedAt === null && !expired,
			attachments: row.attachments.map((attachment) =>
				toAttachmentRef(attachment),
			),
		};
	}

	async search(query: WarningQueryDto): Promise<Paginated<WarningDto>> {
		const now = new Date();

		const where: Prisma.WarningWhereInput = {
			guildId: this.guild.guildId,
			...(query.userId ? { userId: query.userId } : {}),
			// Le `OR` du filtre membre est imbrique sous `user` : il ne peut pas
			// entrer en conflit avec celui de `activeOnly`, qui vit a la racine
			// du `where`.
			...memberSearchFilter(query.member),
			...(query.severity ? { severity: query.severity } : {}),
			...(query.activeOnly
				? {
						revokedAt: null,
						OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
					}
				: {}),
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
			this.prisma.warning.findMany({
				where,
				orderBy: { createdAt: "desc" },
				skip: query.skip,
				take: query.take,
				include: WARNING_INCLUDE,
			}),
			this.prisma.warning.count({ where }),
		]);

		return paginate(
			rows.map((row) => this.toDto(row)),
			total,
			query,
		);
	}

	async findOne(id: string): Promise<WarningDto> {
		const row = await this.prisma.warning.findFirst({
			where: { id, guildId: this.guild.guildId },
			include: WARNING_INCLUDE,
		});

		if (!row) throw new NotFoundException("Avertissement introuvable.");
		return this.toDto(row);
	}

	async create(
		dto: CreateWarningDto,
		actor: AuthenticatedUser,
	): Promise<WarningDto> {
		const guildId = this.guild.guildId;

		// Le membre doit exister : un avertissement sur un identifiant inconnu
		// serait invisible dans le dashboard et impossible a rattacher ensuite.
		const member = await this.prisma.member.findUnique({
			where: { guildId_userId: { guildId, userId: dto.userId } },
		});

		if (!member) {
			throw new NotFoundException(
				`Membre ${dto.userId} inconnu sur ce serveur. Le bot doit l'avoir enregistré au préalable.`,
			);
		}

		if (dto.expiresAt && new Date(dto.expiresAt).getTime() <= Date.now()) {
			throw new BadRequestException(
				"La date d expiration doit se situer dans le futur.",
			);
		}

		// Le bareme ne donne que le defaut : une fois copie dans la ligne, le
		// poids de cet avertissement ne bouge plus, meme si le bareme change.
		const points =
			dto.points ?? (await this.pointsConfig.pointsForWarning(dto.severity));

		const created = await this.prisma.warning.create({
			data: {
				guildId,
				userId: dto.userId,
				createdById: actor.id,
				reason: dto.reason,
				severity: dto.severity,
				points,
				expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
			},
			include: WARNING_INCLUDE,
		});

		await this.prisma.moderationActivity.create({
			data: {
				guildId,
				appUserId: actor.id,
				action: "warn",
				targetUserId: dto.userId,
				targetType: "warning",
				targetId: created.id,
				metadata: { severity: dto.severity, points },
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "warning.create",
			entityType: "warning",
			entityId: created.id,
			after: {
				userId: dto.userId,
				reason: dto.reason,
				severity: dto.severity,
			},
		});

		return this.toDto(created);
	}

	async revoke(
		id: string,
		dto: RevokeDto,
		actor: AuthenticatedUser,
	): Promise<WarningDto> {
		const existing = await this.prisma.warning.findFirst({
			where: { id, guildId: this.guild.guildId },
		});

		if (!existing)
			throw new NotFoundException("Avertissement introuvable.");
		if (existing.revokedAt) {
			throw new BadRequestException(
				"Cet avertissement est déjà révoqué.",
			);
		}

		const updated = await this.prisma.warning.update({
			where: { id },
			data: {
				revokedAt: new Date(),
				revokedById: actor.id,
				revokeReason: dto.reason,
			},
			include: WARNING_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "warning.revoke",
			entityType: "warning",
			entityId: id,
			after: { reason: dto.reason },
		});

		return this.toDto(updated);
	}
}
