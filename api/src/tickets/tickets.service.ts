import { Injectable, NotFoundException } from "@nestjs/common";
import type { TicketAttachment } from "@anubis/shared/prisma";
import type { Prisma } from "@anubis/shared/prisma";
import type {
	Paginated,
	TicketDetail,
	TicketEventDto,
	TicketListItem,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { paginate } from "../common/dto/pagination.dto";
import { GuildContextService } from "../common/guild-context.service";
import { toActorRef, toMemberRef } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type {
	AddTicketNoteDto,
	TicketQueryDto,
	UpdateTicketDto,
} from "./dto/ticket.dto";

const TICKET_INCLUDE = {
	opener: true,
	assignee: true,
	claimedBy: true,
	closedBy: true,
} satisfies Prisma.TicketInclude;

type TicketRow = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

/**
 * Ordre de tri des priorites. PostgreSQL trie les enums selon leur ordre de
 * declaration, ce qui donnerait LOW avant URGENT : on force donc un tri
 * explicite cote application quand la priorite est le critere.
 */
const PRIORITY_RANK: Record<string, number> = {
	URGENT: 3,
	HIGH: 2,
	NORMAL: 1,
	LOW: 0,
};

@Injectable()
export class TicketsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	private toListItem(row: TicketRow): TicketListItem {
		const firstResponseSeconds = row.firstResponseAt
			? Math.round(
					(row.firstResponseAt.getTime() - row.openedAt.getTime()) /
						1000,
				)
			: null;

		const resolutionSeconds = row.closedAt
			? Math.round(
					(row.closedAt.getTime() - row.openedAt.getTime()) / 1000,
				)
			: null;

		return {
			id: row.id,
			number: row.number,
			subject: row.subject,
			category: row.category,
			status: row.status,
			priority: row.priority,
			opener: toMemberRef(row.opener),
			assignee: row.assignee ? toMemberRef(row.assignee) : null,
			openedAt: row.openedAt.toISOString(),
			closedAt: row.closedAt?.toISOString() ?? null,
			messageCount: row.messageCount,
			firstResponseSeconds,
			resolutionSeconds,
			rating: row.rating,
		};
	}

	async search(query: TicketQueryDto): Promise<Paginated<TicketListItem>> {
		const where: Prisma.TicketWhereInput = {
			guildId: this.guild.guildId,
			...(query.status ? { status: query.status } : {}),
			...(query.priority ? { priority: query.priority } : {}),
			...(query.category ? { category: query.category } : {}),
			...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
			...(query.openerId ? { openerId: query.openerId } : {}),
			...(query.search
				? {
						OR: [
							{
								subject: {
									contains: query.search,
									mode: "insensitive",
								},
							},
							...(Number.isInteger(Number(query.search))
								? [{ number: Number(query.search) }]
								: []),
						],
					}
				: {}),
			...(query.from || query.to
				? {
						openedAt: {
							...(query.from
								? { gte: new Date(query.from) }
								: {}),
							...(query.to ? { lte: new Date(query.to) } : {}),
						},
					}
				: {}),
		};

		// La priorite se trie en memoire, sur la page courante uniquement : c'est
		// suffisant tant que le tri principal reste la date d'ouverture.
		const orderBy: Prisma.TicketOrderByWithRelationInput =
			query.sortBy === "priority"
				? { openedAt: "desc" }
				: { [query.sortBy]: query.sortDir };

		const [rows, total] = await Promise.all([
			this.prisma.ticket.findMany({
				where,
				orderBy,
				skip: query.skip,
				take: query.take,
				include: TICKET_INCLUDE,
			}),
			this.prisma.ticket.count({ where }),
		]);

		const items = rows.map((row) => this.toListItem(row));

		if (query.sortBy === "priority") {
			const factor = query.sortDir === "asc" ? 1 : -1;
			items.sort(
				(a, b) =>
					factor *
					((PRIORITY_RANK[a.priority] ?? 0) -
						(PRIORITY_RANK[b.priority] ?? 0)),
			);
		}

		return paginate(items, total, query);
	}

	async findOne(id: string): Promise<TicketDetail> {
		const row = await this.prisma.ticket.findFirst({
			where: { id, guildId: this.guild.guildId },
			include: {
				...TICKET_INCLUDE,
				events: {
					orderBy: { occurredAt: "asc" },
					include: { actor: true, appUser: true },
				},
			},
		});

		if (!row) throw new NotFoundException("Ticket introuvable.");

		const events: TicketEventDto[] = row.events.map((event) => ({
			id: event.id.toString(),
			type: event.type,
			actor:
				event.actor || event.appUser
					? toActorRef(event.actor, event.appUser)
					: null,
			payload: (event.payload as Record<string, unknown> | null) ?? null,
			occurredAt: event.occurredAt.toISOString(),
		}));

		return {
			...this.toListItem(row),
			guildId: row.guildId,
			channelId: row.channelId,
			claimedBy: row.claimedBy ? toActorRef(null, row.claimedBy) : null,
			closedBy: row.closedBy ? toActorRef(null, row.closedBy) : null,
			closeReason: row.closeReason,
			events,
		};
	}

	async update(
		id: string,
		dto: UpdateTicketDto,
		actor: AuthenticatedUser,
	): Promise<TicketDetail> {
		const existing = await this.prisma.ticket.findFirst({
			where: { id, guildId: this.guild.guildId },
		});

		if (!existing) throw new NotFoundException("Ticket introuvable.");

		const closing = dto.status === "CLOSED" && existing.status !== "CLOSED";
		const reopening =
			dto.status !== undefined &&
			dto.status !== "CLOSED" &&
			existing.status === "CLOSED";

		const data: Prisma.TicketUpdateInput = {
			...(dto.status ? { status: dto.status } : {}),
			...(dto.priority ? { priority: dto.priority } : {}),
			...(dto.category ? { category: dto.category } : {}),
			...(dto.assigneeId !== undefined
				? {
						assignee: dto.assigneeId
							? { connect: { id: dto.assigneeId } }
							: { disconnect: true },
					}
				: {}),
			...(closing
				? {
						closedAt: new Date(),
						closedBy: { connect: { id: actor.id } },
						closeReason: dto.closeReason ?? null,
					}
				: {}),
			...(reopening
				? { closedAt: null, closedBy: { disconnect: true } }
				: {}),
		};

		await this.prisma.$transaction(async (tx) => {
			await tx.ticket.update({ where: { id }, data });

			// Chaque changement laisse une trace dans le fil du ticket : c'est ce qui
			// rend le suivi lisible apres coup.
			const events: Prisma.TicketEventCreateManyInput[] = [];

			if (dto.status && dto.status !== existing.status) {
				events.push({
					ticketId: id,
					type: reopening
						? "REOPENED"
						: dto.status === "CLOSED"
							? "CLOSED"
							: "STATUS_CHANGED",
					appUserId: actor.id,
					payload: { from: existing.status, to: dto.status },
				});
			}

			if (dto.priority && dto.priority !== existing.priority) {
				events.push({
					ticketId: id,
					type: "PRIORITY_CHANGED",
					appUserId: actor.id,
					payload: { from: existing.priority, to: dto.priority },
				});
			}

			if (
				dto.assigneeId !== undefined &&
				dto.assigneeId !== existing.assigneeId
			) {
				events.push({
					ticketId: id,
					type: "ASSIGNED",
					appUserId: actor.id,
					payload: { from: existing.assigneeId, to: dto.assigneeId },
				});
			}

			if (events.length) {
				await tx.ticketEvent.createMany({ data: events });
			}
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "ticket.update",
			entityType: "ticket",
			entityId: id,
			before: {
				status: existing.status,
				priority: existing.priority,
				assigneeId: existing.assigneeId,
			},
			after: { ...dto },
		});

		if (closing) {
			await this.prisma.moderationActivity.create({
				data: {
					guildId: this.guild.guildId,
					appUserId: actor.id,
					action: "ticket.close",
					targetType: "ticket",
					targetId: id,
				},
			});
		}

		return this.findOne(id);
	}

	/** Note interne : visible du staff dans le fil, jamais envoyee sur Discord. */
	async addInternalNote(
		id: string,
		dto: AddTicketNoteDto,
		actor: AuthenticatedUser,
	): Promise<TicketDetail> {
		const exists = await this.prisma.ticket.count({
			where: { id, guildId: this.guild.guildId },
		});

		if (!exists) throw new NotFoundException("Ticket introuvable.");

		await this.prisma.ticketEvent.create({
			data: {
				ticketId: id,
				type: "INTERNAL_NOTE",
				appUserId: actor.id,
				payload: { body: dto.body },
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "ticket.note",
			entityType: "ticket",
			entityId: id,
		});

		return this.findOne(id);
	}

	/**
	 * Octets d'une piece jointe, pour l'endpoint de telechargement. Verifie que
	 * le ticket appartient bien au serveur administre avant de renvoyer quoi
	 * que ce soit.
	 */
	async getAttachment(
		ticketId: string,
		attachmentId: string,
	): Promise<TicketAttachment> {
		const attachment = await this.prisma.ticketAttachment.findFirst({
			where: { id: attachmentId, ticketId, ticket: { guildId: this.guild.guildId } },
		});

		if (!attachment) throw new NotFoundException("Piece jointe introuvable.");

		return attachment;
	}
}
