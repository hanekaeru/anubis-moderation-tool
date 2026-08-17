import type { Message } from "discord.js";
import {
	TICKET_CATEGORY_LABELS,
	TicketCategory,
	TicketEventType,
	TicketStatus,
} from "@anubis/shared";
import { Prisma } from "@anubis/shared/prisma";
import prisma from "../prisma";

/**
 * Tickets.
 *
 * Miroir cote bot de `api/src/tickets/tickets.service.ts` pour l'ecriture :
 * memes types d'evenements (`TicketEvent`), mais l'acteur est un membre ou un
 * moderateur Discord (`actorId`) plutot qu'un compte dashboard (`appUserId`).
 * Chaque fermeture pose en plus une ligne `ModerationActivity`, pour la
 * parite avec la fermeture deja loguee cote webapp.
 */

/** Plafond Discord "classique" (hors boost) : au-dela, la piece jointe est ignoree. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_NUMBER_ATTEMPTS = 5;

/**
 * channelId -> ticketId, pour ne pas requeter la base a chaque message.
 *
 * Peuple au demarrage par `loadTicketChannelsCache`, tenu a jour a la
 * creation et a la suppression du salon — meme logique que le cache
 * `contexteConnu` de `referentiel.garantirContexte`.
 */
const ticketChannels = new Map<string, string>();

export function ticketIdForChannel(channelId: string): string | null {
	return ticketChannels.get(channelId) ?? null;
}

export function forgetChannel(channelId: string): void {
	ticketChannels.delete(channelId);
}

export async function loadTicketChannelsCache(guildId: string): Promise<void> {
	const tickets = await prisma.ticket.findMany({
		where: { guildId, channelId: { not: null } },
		select: { id: true, channelId: true },
	});

	for (const ticket of tickets) {
		if (ticket.channelId) ticketChannels.set(ticket.channelId, ticket.id);
	}

	if (tickets.length) {
		console.log(`[Tickets] ${tickets.length} salon(s) de ticket rattaché(s).`);
	}
}

export async function hasOpenTicket(
	guildId: string,
	openerId: string,
): Promise<boolean> {
	const existing = await prisma.ticket.findFirst({
		where: { guildId, openerId, status: { not: TicketStatus.CLOSED } },
		select: { id: true },
	});
	return existing !== null;
}

export async function getTicketSummary(ticketId: string) {
	return prisma.ticket.findUnique({
		where: { id: ticketId },
		select: {
			number: true,
			category: true,
			status: true,
			openerId: true,
			guildId: true,
		},
	});
}

function isUniqueNumberConflict(err: unknown): boolean {
	return (
		err instanceof Prisma.PrismaClientKnownRequestError &&
		err.code === "P2002" &&
		Array.isArray(err.meta?.target) &&
		(err.meta.target as string[]).includes("number")
	);
}

interface CreateTicketInput {
	guildId: string;
	openerId: string;
	category: TicketCategory;
}

/**
 * Cree le ticket en base (sans salon Discord : cree separement par
 * l'appelant, qui a besoin de l'identifiant du ticket pour le customId de ses
 * boutons avant de pouvoir poser `channelId`).
 *
 * Le numero est calcule par lecture du maximum courant puis tentative de
 * creation : en cas de collision (deux ouvertures simultanees), on relit et
 * on retente plutot que de verrouiller la table a la main.
 */
export async function createTicket(input: CreateTicketInput) {
	for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
		const last = await prisma.ticket.aggregate({
			where: { guildId: input.guildId },
			_max: { number: true },
		});
		const number = (last._max.number ?? 0) + 1;

		try {
			return await prisma.$transaction(async (tx) => {
				const ticket = await tx.ticket.create({
					data: {
						guildId: input.guildId,
						number,
						openerId: input.openerId,
						subject: TICKET_CATEGORY_LABELS[input.category],
						category: input.category,
					},
				});

				await tx.ticketEvent.create({
					data: {
						ticketId: ticket.id,
						type: TicketEventType.OPENED,
						actorId: input.openerId,
						payload: { category: input.category },
					},
				});

				return ticket;
			});
		} catch (err) {
			if (isUniqueNumberConflict(err)) continue;
			throw err;
		}
	}

	throw new Error(
		"Impossible d'attribuer un numéro de ticket après plusieurs tentatives.",
	);
}

export async function attachChannel(
	ticketId: string,
	channelId: string,
): Promise<void> {
	await prisma.ticket.update({
		where: { id: ticketId },
		// Le salon vient d'etre cree dans l'etat attendu : rien a rattraper.
		data: { channelId, discordSyncedAt: new Date() },
	});
	ticketChannels.set(channelId, ticketId);
}

interface AttachmentInput {
	fileName: string;
	contentType: string;
	url: string;
	size: number;
}

async function downloadAttachment(
	attachment: AttachmentInput,
): Promise<{ fileName: string; contentType: string; size: number; data: Buffer } | null> {
	if (attachment.size > MAX_ATTACHMENT_BYTES) {
		console.warn(
			`[Tickets] Pièce jointe "${attachment.fileName}" ignorée (${attachment.size} octets > plafond).`,
		);
		return null;
	}

	try {
		const response = await fetch(attachment.url);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const data = Buffer.from(await response.arrayBuffer());
		return {
			fileName: attachment.fileName,
			contentType: attachment.contentType || "application/octet-stream",
			size: data.byteLength,
			data,
		};
	} catch (err) {
		console.error(
			`[Tickets] Téléchargement de la pièce jointe "${attachment.fileName}" échoué :`,
			err,
		);
		return null;
	}
}

/**
 * Enregistre un message pose dans un salon de ticket : compteur, premiere
 * reponse du staff le cas echeant, contenu et pieces jointes.
 *
 * Necessite l'intent privilegie Message Content — sans lui, `message.content`
 * est vide pour tout message qui ne mentionne pas le bot.
 */
export async function recordMessage(
	ticketId: string,
	message: Message<true>,
): Promise<void> {
	const ticket = await prisma.ticket.findUnique({
		where: { id: ticketId },
		select: { openerId: true, firstResponseAt: true },
	});
	if (!ticket) return;

	const downloaded = await Promise.all(
		[...message.attachments.values()].map((attachment) =>
			downloadAttachment({
				fileName: attachment.name,
				contentType: attachment.contentType ?? "application/octet-stream",
				url: attachment.url,
				size: attachment.size,
			}),
		),
	);
	const successful = downloaded.filter((item) => item !== null);

	const isFirstStaffReply =
		message.author.id !== ticket.openerId && ticket.firstResponseAt === null;

	await prisma.$transaction(async (tx) => {
		const createdAttachments = await Promise.all(
			successful.map((attachment) =>
				tx.ticketAttachment.create({
					data: { ticketId, ...attachment },
					select: { id: true, fileName: true, contentType: true, size: true },
				}),
			),
		);

		await tx.ticketEvent.create({
			data: {
				ticketId,
				type: TicketEventType.MESSAGE,
				actorId: message.author.id,
				payload: {
					content: message.content || null,
					attachments: createdAttachments,
				},
			},
		});

		await tx.ticket.update({
			where: { id: ticketId },
			data: {
				messageCount: { increment: 1 },
				...(isFirstStaffReply ? { firstResponseAt: new Date() } : {}),
			},
		});
	});
}

export async function closeTicket(
	ticketId: string,
	actorId: string,
): Promise<void> {
	const existing = await prisma.ticket.findUnique({
		where: { id: ticketId },
		select: { guildId: true, status: true },
	});
	if (!existing || existing.status === TicketStatus.CLOSED) return;

	await prisma.$transaction(async (tx) => {
		await tx.ticket.update({
			where: { id: ticketId },
			data: {
				status: TicketStatus.CLOSED,
				closedAt: new Date(),
				// Deja applique par l'appelant (permissions du salon, embed) : rien
				// a rattraper pour bot/src/tasks/ticketSync.ts.
				discordSyncedAt: new Date(),
			},
		});

		await tx.ticketEvent.create({
			data: {
				ticketId,
				type: TicketEventType.CLOSED,
				actorId,
				payload: { from: existing.status, to: TicketStatus.CLOSED },
			},
		});
	});

	await prisma.moderationActivity.create({
		data: {
			guildId: existing.guildId,
			moderatorId: actorId,
			action: "ticket.close",
			targetType: "ticket",
			targetId: ticketId,
		},
	});
}

export async function reopenTicket(
	ticketId: string,
	actorId: string,
): Promise<void> {
	const existing = await prisma.ticket.findUnique({
		where: { id: ticketId },
		select: { status: true },
	});
	if (!existing || existing.status !== TicketStatus.CLOSED) return;

	await prisma.$transaction(async (tx) => {
		await tx.ticket.update({
			where: { id: ticketId },
			data: { status: TicketStatus.OPEN, closedAt: null, discordSyncedAt: new Date() },
		});

		await tx.ticketEvent.create({
			data: {
				ticketId,
				type: TicketEventType.REOPENED,
				actorId,
				payload: { from: TicketStatus.CLOSED, to: TicketStatus.OPEN },
			},
		});
	});
}

/** Fil texte lisible, poste dans le salon d'archive avant suppression du salon. */
export async function buildTranscript(ticketId: string): Promise<string> {
	const ticket = await prisma.ticket.findUnique({
		where: { id: ticketId },
		include: {
			opener: true,
			events: {
				orderBy: { occurredAt: "asc" },
				include: { actor: true },
			},
		},
	});
	if (!ticket) return "Ticket introuvable.";

	const lignes = [
		`Ticket #${ticket.number} — ${ticket.subject}`,
		`Ouvert par ${ticket.opener.username} (${ticket.opener.id}) le ${ticket.openedAt.toISOString()}`,
		"",
	];

	for (const event of ticket.events) {
		const auteur = event.actor?.username ?? "systeme";
		const horodatage = event.occurredAt.toISOString();

		if (event.type === TicketEventType.MESSAGE) {
			const payload = event.payload as {
				content: string | null;
				attachments: { fileName: string }[];
			} | null;
			const contenu = payload?.content ?? "";
			const pieces = payload?.attachments?.length
				? ` [pièces jointes : ${payload.attachments.map((a) => a.fileName).join(", ")}]`
				: "";
			lignes.push(`[${horodatage}] ${auteur} : ${contenu}${pieces}`);
		} else {
			lignes.push(`[${horodatage}] ${auteur} — ${event.type}`);
		}
	}

	return lignes.join("\n");
}

/**
 * Pose l'evenement de cloture du fil (channel supprime), oublie le salon du
 * cache et detache `channelId` — le ticket reste consultable indefiniment
 * sur la webapp, seul le salon Discord disparait.
 */
export async function archiveAndForgetChannel(
	ticketId: string,
	channelId: string,
	channelName: string,
	transcriptPosted: boolean,
): Promise<void> {
	await prisma.ticketEvent.create({
		data: {
			ticketId,
			type: TicketEventType.TRANSCRIPT_ARCHIVED,
			payload: { channelName, transcriptPosted },
		},
	});

	await prisma.ticket.update({
		where: { id: ticketId },
		data: { channelId: null },
	});

	forgetChannel(channelId);
}
