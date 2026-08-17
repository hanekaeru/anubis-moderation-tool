import { ChannelType, type Client, type TextChannel } from "discord.js";
import { TICKET_CATEGORY_LABELS, TicketStatus, type TicketCategory } from "@anubis/shared";
import prisma from "../prisma";
import {
	closeButtonRow,
	closedEmbed,
	openEmbed,
	reopenDeleteButtonRow,
	setOpenerCanWrite,
} from "../utils/ticketChannel";

/**
 * Repercute cote Discord un changement de statut de ticket fait depuis la
 * webapp (`TicketsService.update`), qui ne touche qu'a la base.
 *
 * Meme patron que `sanctionSync.ts` : `Ticket.discordSyncedAt` reste `null`
 * tant que le bot n'a pas rejoue l'effet Discord (permission d'ecriture de
 * l'ouvreur, embed de controle) ; un changement fait par les boutons du bot
 * lui-meme (`src/handlers/ticketInteractions.ts`) l'a deja pose.
 */
export async function checkPendingTicketSync(client: Client): Promise<void> {
	const pending = await prisma.ticket.findMany({
		where: { channelId: { not: null }, discordSyncedAt: null },
	});

	for (const ticket of pending) {
		const guild = client.guilds.cache.get(ticket.guildId);
		const channel =
			guild && ticket.channelId
				? await guild.channels.fetch(ticket.channelId).catch(() => null)
				: null;

		if (!channel || channel.type !== ChannelType.GuildText) {
			// Salon introuvable (supprime entre-temps sans passer par le bouton
			// "Supprimer") : rien a rejouer, on arrete d'attendre pour ce ticket.
			await prisma.ticket.update({
				where: { id: ticket.id },
				data: { discordSyncedAt: new Date() },
			});
			continue;
		}

		try {
			const isClosed = ticket.status === TicketStatus.CLOSED;
			await setOpenerCanWrite(channel, ticket.openerId, !isClosed);
			await syncControlMessage(channel, ticket, isClosed);
		} catch (err) {
			console.error(
				`[Tickets] Synchronisation Discord du ticket ${ticket.id} échouée :`,
				err,
			);
		}

		await prisma.ticket.update({
			where: { id: ticket.id },
			data: { discordSyncedAt: new Date() },
		});
	}
}

interface TicketRow {
	id: string;
	number: number;
	category: TicketCategory;
	openerId: string;
}

/**
 * Retrouve et met a jour le message de controle (embed + boutons), sans le
 * stocker en base : c'est le seul message du salon poste par le bot avec des
 * composants. Best-effort sur les 50 derniers messages — au-dela, le message
 * ne serait de toute facon plus visible sans faire defiler le salon.
 */
async function syncControlMessage(
	channel: TextChannel,
	ticket: TicketRow,
	isClosed: boolean,
): Promise<void> {
	const messages = await channel.messages.fetch({ limit: 50 });
	const control = messages.find(
		(m) => m.author.id === channel.client.user.id && m.components.length > 0,
	);
	if (!control) return;

	const categoryLabel = TICKET_CATEGORY_LABELS[ticket.category];

	if (isClosed) {
		await control
			.edit({
				embeds: [closedEmbed(ticket.number, categoryLabel)],
				components: [reopenDeleteButtonRow(ticket.id)],
			})
			.catch(() => undefined);
	} else {
		await control
			.edit({
				embeds: [openEmbed(ticket.number, categoryLabel, ticket.openerId)],
				components: [closeButtonRow(ticket.id)],
			})
			.catch(() => undefined);
	}
}
