import {
	ChannelType,
	MessageFlags,
	PermissionFlagsBits,
	type ButtonInteraction,
	type StringSelectMenuInteraction,
} from "discord.js";
import { TICKET_CATEGORY_LABELS, TicketCategory } from "@anubis/shared";
import * as referentiel from "../collectors/referentiel";
import * as tickets from "../collectors/tickets";
import {
	closeButtonRow,
	closedEmbed,
	createTicketChannel,
	ensureTranscriptChannel,
	openEmbed,
	reopenDeleteButtonRow,
	setOpenerCanWrite,
} from "../utils/ticketChannel";

/**
 * Anti-spam sur l'ouverture de ticket : `hasOpenTicket` bloque deja les
 * doublons, mais pas les clics repetes sur le select menu (chacun declenche
 * une requete DB) ni les cycles ouverture -> fermeture -> reouverture rapides.
 * Cooldown memoire minimal, sur le modele des cooldowns de commande
 * (`events/interactionCreate.ts`).
 */
const OPEN_COOLDOWN_MS = 30_000;
const lastOpenAttempt = new Map<string, number>();

/** Select menu du panneau (`ticket:open`) : choix de la raison -> creation du salon prive. */
export async function handleTicketOpenSelect(
	interaction: StringSelectMenuInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	const category = interaction.values[0] as TicketCategory;
	if (!Object.values(TicketCategory).includes(category)) return;

	// `deferUpdate` (et non `deferReply`) accuse reception sur le message du
	// panneau lui-meme : c'est ce qui reinitialise le select a son placeholder
	// cote client. Un `deferReply` cree une reponse a part et laisse le menu
	// affiche bloque sur la derniere valeur choisie.
	await interaction.deferUpdate();

	const now = Date.now();
	const last = lastOpenAttempt.get(interaction.user.id);
	if (last !== undefined && now - last < OPEN_COOLDOWN_MS) {
		await interaction.followUp({
			content: "Merci de patienter un peu avant de retenter d'ouvrir un ticket.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	lastOpenAttempt.set(interaction.user.id, now);

	if (await tickets.hasOpenTicket(interaction.guildId, interaction.user.id)) {
		await interaction.followUp({
			content:
				"Tu as deja un ticket ouvert sur ce serveur. Utilise-le avant d'en ouvrir un nouveau.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	await referentiel.upsertUser(interaction.user);

	const ticket = await tickets.createTicket({
		guildId: interaction.guildId,
		openerId: interaction.user.id,
		category,
	});

	const channel = await createTicketChannel({
		guild: interaction.guild,
		openerId: interaction.user.id,
		ticketId: ticket.id,
		number: ticket.number,
		categoryLabel: TICKET_CATEGORY_LABELS[category],
	});

	await tickets.attachChannel(ticket.id, channel.id);

	await interaction.followUp({
		content: `Ton ticket a ete cree : ${channel}`,
		flags: MessageFlags.Ephemeral,
	});
}

/** Boutons du panneau de controle d'un ticket : `ticket:<close|reopen|delete>:<ticketId>`. */
export async function handleTicketButton(
	interaction: ButtonInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	const [, action, ticketId] = interaction.customId.split(":");
	if (!ticketId) return;

	if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
		await interaction.reply({
			content: "Tu n'as pas la permission de gerer les tickets.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const channel = interaction.channel;
	if (!channel || channel.type !== ChannelType.GuildText) return;

	if (action === "close") {
		await tickets.closeTicket(ticketId, interaction.user.id);
		const summary = await tickets.getTicketSummary(ticketId);
		if (!summary) return;

		await setOpenerCanWrite(channel, summary.openerId, false);
		await interaction.update({
			embeds: [closedEmbed(summary.number, TICKET_CATEGORY_LABELS[summary.category])],
			components: [reopenDeleteButtonRow(ticketId)],
		});
		return;
	}

	if (action === "reopen") {
		await tickets.reopenTicket(ticketId, interaction.user.id);
		const summary = await tickets.getTicketSummary(ticketId);
		if (!summary) return;

		await setOpenerCanWrite(channel, summary.openerId, true);
		await interaction.update({
			embeds: [
				openEmbed(summary.number, TICKET_CATEGORY_LABELS[summary.category], summary.openerId),
			],
			components: [closeButtonRow(ticketId)],
		});
		return;
	}

	if (action === "delete") {
		await interaction.deferUpdate();

		const summary = await tickets.getTicketSummary(ticketId);
		if (!summary) return;

		const transcript = await tickets.buildTranscript(ticketId);
		const transcriptChannel = await ensureTranscriptChannel(interaction.guild);

		let transcriptPosted = true;
		try {
			await transcriptChannel.send({
				content: `Transcript du ticket #${summary.number} (${TICKET_CATEGORY_LABELS[summary.category]})`,
				files: [
					{
						attachment: Buffer.from(transcript, "utf-8"),
						name: `ticket-${summary.number}.txt`,
					},
				],
			});
		} catch (err) {
			console.error("[Tickets] Envoi du transcript echoue :", err);
			transcriptPosted = false;
		}

		await tickets.archiveAndForgetChannel(
			ticketId,
			channel.id,
			channel.name,
			transcriptPosted,
		);
		await channel.delete();
	}
}
