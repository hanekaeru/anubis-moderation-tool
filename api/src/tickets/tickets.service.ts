import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { TicketAttachment } from "@anubis/shared/prisma";
import type { Prisma } from "@anubis/shared/prisma";
import {
	DEFAULT_MAX_OPEN_TICKETS,
	MAX_TICKET_PREFIX_LENGTH,
	MAX_TICKET_SUBJECTS,
	slugifyChannelPart,
	type Paginated,
	type TicketConfigDto,
	type TicketDetail,
	type TicketEventDto,
	type TicketListItem,
	type TicketModeratorPrefixDto,
	type TicketSubjectDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { paginate } from "../common/dto/pagination.dto";
import { GuildContextService } from "../common/guild-context.service";
import { toActorRef, toMemberRef } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type {
	AddTicketNoteDto,
	CreateTicketSubjectDto,
	TicketQueryDto,
	UpdateTicketConfigDto,
	UpdateTicketDto,
	UpdateTicketSubjectDto,
	UpsertTicketPrefixDto,
} from "./dto/ticket.dto";

const TICKET_INCLUDE = {
	opener: true,
	assignee: true,
	claimedBy: true,
	claimedByDiscord: true,
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
			claimedAt: row.claimedAt?.toISOString() ?? null,
			closedAt: row.closedAt?.toISOString() ?? null,
			messageCount: row.messageCount,
			firstResponseSeconds,
			resolutionSeconds,
			rating: row.rating,
		};
	}

	private toSubjectDto(row: {
		id: string;
		label: string;
		description: string | null;
		emoji: string | null;
		category: TicketSubjectDto["category"];
		defaultPriority: TicketSubjectDto["defaultPriority"];
		position: number;
		enabled: boolean;
	}): TicketSubjectDto {
		return {
			id: row.id,
			label: row.label,
			description: row.description,
			emoji: row.emoji,
			category: row.category,
			defaultPriority: row.defaultPriority,
			position: row.position,
			enabled: row.enabled,
		};
	}

	/**
	 * Reglages des tickets.
	 *
	 * L'absence de ligne ne vaut pas « aucune limite » : le defaut reproduit
	 * le comportement d'avant le reglage, ou un seul ticket ouvert etait
	 * tolere. Bot, API et dashboard partagent la meme valeur de repli.
	 */
	async getConfig(): Promise<TicketConfigDto> {
		const row = await this.prisma.ticketConfig.findUnique({
			where: { guildId: this.guild.guildId },
		});

		return {
			maxOpenTickets: row?.maxOpenTickets ?? DEFAULT_MAX_OPEN_TICKETS,
			updatedAt: row?.updatedAt.toISOString() ?? null,
		};
	}

	async updateConfig(
		dto: UpdateTicketConfigDto,
		actor: AuthenticatedUser,
	): Promise<TicketConfigDto> {
		const guildId = this.guild.guildId;
		const maxOpenTickets = dto.maxOpenTickets ?? DEFAULT_MAX_OPEN_TICKETS;

		const row = await this.prisma.ticketConfig.upsert({
			where: { guildId },
			create: { guildId, maxOpenTickets },
			update: { maxOpenTickets },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "ticket.config.update",
			entityType: "ticket_config",
			entityId: guildId,
			after: { maxOpenTickets },
		});

		return {
			maxOpenTickets: row.maxOpenTickets,
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	/** Tous les sujets, desactives compris : c'est un ecran de reglage. */
	async listSubjects(): Promise<TicketSubjectDto[]> {
		const rows = await this.prisma.ticketSubject.findMany({
			where: { guildId: this.guild.guildId },
			orderBy: [{ position: "asc" }, { label: "asc" }],
		});

		return rows.map((row) => this.toSubjectDto(row));
	}

	async createSubject(
		dto: CreateTicketSubjectDto,
		actor: AuthenticatedUser,
	): Promise<TicketSubjectDto> {
		const guildId = this.guild.guildId;

		// Le select de la modale Discord plafonne a 25 options : au-dela, les
		// sujets en trop seraient invisibles cote Discord sans que le
		// dashboard ne le laisse deviner.
		const existants = await this.prisma.ticketSubject.count({ where: { guildId } });
		if (existants >= MAX_TICKET_SUBJECTS) {
			throw new ConflictException(
				`Un serveur ne peut pas proposer plus de ${MAX_TICKET_SUBJECTS} sujets de ticket.`,
			);
		}

		const created = await this.prisma.ticketSubject.create({
			data: {
				guildId,
				label: dto.label,
				description: dto.description ?? null,
				emoji: dto.emoji ?? null,
				...(dto.category ? { category: dto.category } : {}),
				...(dto.defaultPriority ? { defaultPriority: dto.defaultPriority } : {}),
				position: dto.position ?? existants,
				enabled: dto.enabled ?? true,
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "ticket.subject.create",
			entityType: "ticket_subject",
			entityId: created.id,
			after: { ...dto },
		});

		return this.toSubjectDto(created);
	}

	async updateSubject(
		id: string,
		dto: UpdateTicketSubjectDto,
		actor: AuthenticatedUser,
	): Promise<TicketSubjectDto> {
		const existing = await this.prisma.ticketSubject.findFirst({
			where: { id, guildId: this.guild.guildId },
		});
		if (!existing) throw new NotFoundException("Sujet de ticket introuvable.");

		const updated = await this.prisma.ticketSubject.update({
			where: { id },
			data: {
				...(dto.label !== undefined ? { label: dto.label } : {}),
				...(dto.description !== undefined
					? { description: dto.description ?? null }
					: {}),
				...(dto.emoji !== undefined ? { emoji: dto.emoji ?? null } : {}),
				...(dto.category !== undefined ? { category: dto.category } : {}),
				...(dto.defaultPriority !== undefined
					? { defaultPriority: dto.defaultPriority }
					: {}),
				...(dto.position !== undefined ? { position: dto.position } : {}),
				...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "ticket.subject.update",
			entityType: "ticket_subject",
			entityId: id,
			before: { label: existing.label, enabled: existing.enabled },
			after: { ...dto },
		});

		return this.toSubjectDto(updated);
	}

	/**
	 * Retire un sujet de la liste.
	 *
	 * Les tickets ouverts avec ce sujet gardent leur intitule : `subject` est
	 * une copie du libelle, et `subjectId` repasse simplement a `null`
	 * (`ON DELETE SET NULL`). Desactiver plutot que supprimer reste preferable
	 * quand on veut garder le lien pour les statistiques.
	 */
	async deleteSubject(id: string, actor: AuthenticatedUser): Promise<void> {
		const existing = await this.prisma.ticketSubject.findFirst({
			where: { id, guildId: this.guild.guildId },
		});
		if (!existing) throw new NotFoundException("Sujet de ticket introuvable.");

		await this.prisma.ticketSubject.delete({ where: { id } });

		await this.audit.record({
			appUserId: actor.id,
			action: "ticket.subject.delete",
			entityType: "ticket_subject",
			entityId: id,
			before: { label: existing.label },
		});
	}

	/** Prefixes de nommage des salons, un par moderateur ayant lance /prefix_ticket. */
	async listPrefixes(): Promise<TicketModeratorPrefixDto[]> {
		const guildId = this.guild.guildId;

		const rows = await this.prisma.ticketModeratorPrefix.findMany({
			where: { guildId },
			orderBy: { prefix: "asc" },
			include: { user: true },
		});

		const charges = await this.prisma.ticket.groupBy({
			by: ["claimedByDiscordId"],
			where: {
				guildId,
				status: { not: "CLOSED" },
				claimedByDiscordId: { not: null },
			},
			_count: { _all: true },
		});

		const parModerateur = new Map(
			charges.map((ligne) => [ligne.claimedByDiscordId, ligne._count._all]),
		);

		return rows.map((row) => ({
			userId: row.userId,
			username: row.user.username,
			displayName: row.user.globalName,
			avatarUrl: row.user.avatarUrl,
			prefix: row.prefix,
			updatedAt: row.updatedAt.toISOString(),
			openTickets: parModerateur.get(row.userId) ?? 0,
		}));
	}

	/**
	 * Modifie le prefixe d'un moderateur depuis le dashboard.
	 *
	 * Normalise comme cote Discord : le nom de salon est de toute facon mis en
	 * minuscules par Discord, et un prefixe saisi ici doit produire exactement
	 * le meme resultat que le meme prefixe saisi par `/prefix_ticket`.
	 *
	 * Ne cree pas de ligne pour un compte inconnu : le prefixe suit un
	 * moderateur que le referentiel a deja croise.
	 */
	async upsertPrefix(
		userId: string,
		dto: UpsertTicketPrefixDto,
		actor: AuthenticatedUser,
	): Promise<TicketModeratorPrefixDto> {
		const guildId = this.guild.guildId;
		const prefix = slugifyChannelPart(dto.prefix).slice(0, MAX_TICKET_PREFIX_LENGTH);

		if (!prefix) {
			throw new ConflictException(
				"Ce préfixe ne contient aucun caractère utilisable dans un nom de salon.",
			);
		}

		const user = await this.prisma.discordUser.findUnique({ where: { id: userId } });
		if (!user) throw new NotFoundException("Compte Discord inconnu.");

		await this.prisma.ticketModeratorPrefix.upsert({
			where: { guildId_userId: { guildId, userId } },
			create: { guildId, userId, prefix },
			update: { prefix },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "ticket.prefix.update",
			entityType: "ticket_moderator_prefix",
			entityId: userId,
			after: { prefix },
		});

		const prefixes = await this.listPrefixes();
		const ligne = prefixes.find((entree) => entree.userId === userId);
		if (!ligne) throw new NotFoundException("Préfixe introuvable.");
		return ligne;
	}

	async deletePrefix(userId: string, actor: AuthenticatedUser): Promise<void> {
		const guildId = this.guild.guildId;

		const existing = await this.prisma.ticketModeratorPrefix.findUnique({
			where: { guildId_userId: { guildId, userId } },
		});
		if (!existing) throw new NotFoundException("Préfixe introuvable.");

		await this.prisma.ticketModeratorPrefix.delete({
			where: { guildId_userId: { guildId, userId } },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "ticket.prefix.delete",
			entityType: "ticket_moderator_prefix",
			entityId: userId,
			before: { prefix: existing.prefix },
		});
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
			claimedBy:
				row.claimedByDiscord || row.claimedBy
					? toActorRef(row.claimedByDiscord, row.claimedBy)
					: null,
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

		/**
		 * Ce que Discord doit refleter : le statut (droit d'ecriture de l'ouvreur
		 * et embed de controle) et la categorie (affichee dans cet embed). La
		 * priorite et l'assignation ne vivent que sur le dashboard.
		 *
		 * Remettre `discordSyncedAt` a `null` est ce qui replace le ticket dans la
		 * file de `bot/src/tasks/ticketSync.ts`. Sans cela, un ticket ouvert
		 * depuis Discord porte deja une date — posee a la creation du salon — et
		 * une fermeture faite depuis la webapp ne quittait jamais la base.
		 */
		const rejouerSurDiscord =
			(dto.status !== undefined && dto.status !== existing.status) ||
			(dto.category !== undefined && dto.category !== existing.category);

		const data: Prisma.TicketUpdateInput = {
			...(dto.status ? { status: dto.status } : {}),
			...(dto.priority ? { priority: dto.priority } : {}),
			...(dto.category ? { category: dto.category } : {}),
			...(rejouerSurDiscord ? { discordSyncedAt: null } : {}),
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

		if (!attachment) throw new NotFoundException("Pièce jointe introuvable.");

		return attachment;
	}
}
