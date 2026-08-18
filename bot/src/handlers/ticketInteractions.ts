import {
	ChannelType,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextInputBuilder,
	TextInputStyle,
	parseEmoji,
	type ButtonInteraction,
	type ComponentEmojiResolvable,
	type ModalSubmitInteraction,
} from "discord.js";
import {
	MAX_TICKET_DESCRIPTION_LENGTH,
	TICKET_PRIORITY_LABELS,
	TicketPriority,
} from "@anubis/shared";
import type { TicketSubject } from "@anubis/shared/prisma";
import * as referentiel from "../collectors/referentiel";
import * as tickets from "../collectors/tickets";
import {
	closeButtonRow,
	closedEmbed,
	createTicketChannel,
	ensureTranscriptChannel,
	openEmbed,
	renameForClaim,
	reopenDeleteButtonRow,
	setOpenerAccess,
} from "../utils/ticketChannel";

/**
 * Ouverture et gestion des tickets depuis Discord.
 *
 * Le panneau porte un **bouton** et non un select : choisir un sujet et une
 * gravite demande une modale, or `showModal` est refuse apres tout accuse de
 * reception — et c'est justement le `deferUpdate` qui remettait le select a sa
 * place. Un bouton n'a pas d'etat a reinitialiser, le probleme disparait.
 */

export const TICKET_OPEN_BUTTON = "ticket:open";
export const TICKET_OPEN_MODAL = "ticket:open:modal";
const CHAMP_SUJET = "subject";
const CHAMP_GRAVITE = "priority";
const CHAMP_DESCRIPTION = "description";

/**
 * Anti-spam sur l'ouverture : la limite de tickets ouverts bloque deja les
 * doublons, mais pas les clics repetes (chacun declenche des requetes DB) ni
 * les cycles ouverture -> fermeture -> reouverture rapides. Cooldown memoire
 * minimal, sur le modele des cooldowns de commande.
 */
const OPEN_COOLDOWN_MS = 30_000;
const lastOpenAttempt = new Map<string, number>();

function emojiDOption(emoji: string | null): ComponentEmojiResolvable | undefined {
	if (!emoji) return undefined;

	const analyse = parseEmoji(emoji);
	if (!analyse?.name) return undefined;

	return analyse.id
		? { id: analyse.id, name: analyse.name, animated: analyse.animated }
		: { name: analyse.name };
}

function modaleDOuverture(sujets: TicketSubject[]): ModalBuilder {
	const modale = new ModalBuilder()
		.setCustomId(TICKET_OPEN_MODAL)
		.setTitle("Ouvrir un ticket");

	const premier = sujets[0];

	modale.addLabelComponents(
		new LabelBuilder()
			.setLabel("Sujet")
			.setStringSelectMenuComponent(
				new StringSelectMenuBuilder()
					.setCustomId(CHAMP_SUJET)
					.setPlaceholder("De quoi veux-tu parler ?")
					.addOptions(
						sujets.map((sujet) => {
							const option = new StringSelectMenuOptionBuilder()
								.setLabel(sujet.label.slice(0, 100))
								.setValue(sujet.id);

							if (sujet.description) {
								option.setDescription(sujet.description.slice(0, 100));
							}

							const emoji = emojiDOption(sujet.emoji);
							if (emoji) option.setEmoji(emoji);

							return option;
						}),
					),
			),
		new LabelBuilder()
			.setLabel("Gravité")
			.setDescription("Aide l'équipe à traiter les urgences en premier.")
			.setStringSelectMenuComponent(
				new StringSelectMenuBuilder()
					.setCustomId(CHAMP_GRAVITE)
					.setPlaceholder(TICKET_PRIORITY_LABELS[TicketPriority.NORMAL])
					.addOptions(
						Object.values(TicketPriority).map((priority) =>
							new StringSelectMenuOptionBuilder()
								.setLabel(TICKET_PRIORITY_LABELS[priority])
								.setValue(priority)
								// La gravite conseillee par le sujet le plus haut de la
								// liste sert de valeur de depart : un membre qui ne
								// touche pas au champ ouvre un ticket coherent.
								.setDefault(priority === (premier?.defaultPriority ?? TicketPriority.NORMAL)),
						),
					),
			),
		new LabelBuilder()
			.setLabel("Ta demande")
			.setTextInputComponent(
				new TextInputBuilder()
					.setCustomId(CHAMP_DESCRIPTION)
					.setStyle(TextInputStyle.Paragraph)
					.setMaxLength(MAX_TICKET_DESCRIPTION_LENGTH)
					.setRequired(false)
					.setPlaceholder("Explique en quelques mots, l'équipe gagnera du temps."),
			),
	);

	return modale;
}

/** Bouton du panneau (`ticket:open`) : ouvre la modale sujet + gravite. */
export async function handleTicketOpenButton(
	interaction: ButtonInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	const now = Date.now();
	const last = lastOpenAttempt.get(interaction.user.id);
	if (last !== undefined && now - last < OPEN_COOLDOWN_MS) {
		await interaction.reply({
			content: "Merci de patienter un peu avant de retenter d'ouvrir un ticket.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// La limite est verifiee **avant** d'ouvrir la modale : la laisser remplir
	// pour la refuser ensuite ferait perdre le texte deja saisi.
	const quota = await tickets.openTicketQuota(interaction.guildId, interaction.user.id);
	if (quota.reached) {
		await interaction.reply({
			content:
				quota.max === 1
					? "Tu as déjà un ticket ouvert sur ce serveur. Utilise-le avant d'en ouvrir un nouveau."
					: `Tu as déjà ${quota.open} tickets ouverts, soit le maximum autorisé sur ce serveur.`,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const sujets = await tickets.listSubjects(interaction.guildId);
	if (!sujets.length) {
		await interaction.reply({
			content:
				"Aucun sujet de ticket n'est configuré pour le moment. Préviens un membre du staff.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Le cooldown n'est pose qu'ici : un refus ci-dessus n'a rien coute et ne
	// doit pas faire patienter trente secondes de plus.
	lastOpenAttempt.set(interaction.user.id, now);

	await interaction.showModal(modaleDOuverture(sujets));
}

/** Soumission de la modale d'ouverture : creation du ticket et de son salon. */
export async function handleTicketOpenModal(
	interaction: ModalSubmitInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	// Reverifiee apres la modale : elle a pu se remplir pendant que le membre
	// ouvrait un ticket ailleurs, ou pendant qu'un moderateur baissait la
	// limite depuis le dashboard.
	const quota = await tickets.openTicketQuota(interaction.guildId, interaction.user.id);
	if (quota.reached) {
		await interaction.editReply({
			content: "Tu as atteint le nombre de tickets ouverts autorisé sur ce serveur.",
		});
		return;
	}

	const subjectId = interaction.fields.getStringSelectValues(CHAMP_SUJET)[0];
	const sujet = subjectId
		? await tickets.findSubject(interaction.guildId, subjectId)
		: null;

	if (!sujet) {
		await interaction.editReply({
			content: "Ce sujet n'est plus disponible. Réessaie depuis le panneau.",
		});
		return;
	}

	const graviteBrute = interaction.fields.getStringSelectValues(CHAMP_GRAVITE)[0];
	const priority = Object.values(TicketPriority).includes(
		graviteBrute as TicketPriority,
	)
		? (graviteBrute as TicketPriority)
		: sujet.defaultPriority;

	const description =
		interaction.fields.getTextInputValue(CHAMP_DESCRIPTION).trim() || null;

	await referentiel.upsertUser(interaction.user);

	const ticket = await tickets.createTicket({
		guildId: interaction.guildId,
		openerId: interaction.user.id,
		subject: sujet,
		priority,
		description,
	});

	const channel = await createTicketChannel({
		guild: interaction.guild,
		ticketId: ticket.id,
		state: {
			number: ticket.number,
			subject: ticket.subject,
			priority,
			openerId: interaction.user.id,
			description,
		},
	});

	await tickets.attachChannel(ticket.id, channel.id);

	await interaction.editReply({ content: `Ton ticket a été créé : ${channel}` });
}

/** Boutons du panneau de controle : `ticket:<claim|close|reopen|delete>:<ticketId>`. */
export async function handleTicketButton(
	interaction: ButtonInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	const [, action, ticketId] = interaction.customId.split(":");
	if (!ticketId) return;

	if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
		await interaction.reply({
			content: "Tu n'as pas la permission de gérer les tickets.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const channel = interaction.channel;
	if (!channel || channel.type !== ChannelType.GuildText) return;

	if (action === "claim") {
		// Le prefixe nomme le salon : sans lui, rien a ecrire. Le deviner a
		// partir du pseudo donnerait des noms incoherents avec ceux que le
		// moderateur a deja poses.
		const prefix = await tickets.getPrefix(interaction.guildId, interaction.user.id);
		if (!prefix) {
			await interaction.reply({
				content:
					"Tu n'as pas encore de préfixe de ticket. Utilise `/prefix_ticket` pour en choisir un, puis reprends le ticket.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferUpdate();

		await referentiel.upsertUser(interaction.user);

		const pris = await tickets.claimTicket(ticketId, interaction.user.id);
		const summary = await tickets.getTicketSummary(ticketId);
		if (!summary) return;

		if (!pris) {
			await interaction.followUp({
				content: summary.claimedByDiscordId
					? `Ce ticket est déjà pris en charge par <@${summary.claimedByDiscordId}>.`
					: "Ce ticket est déjà pris en charge.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const renomme = await renameForClaim(
			channel,
			prefix,
			summary.opener.username,
			summary.number,
		);

		await interaction.editReply({
			embeds: [
				openEmbed({
					number: summary.number,
					subject: summary.subject,
					priority: summary.priority,
					openerId: summary.openerId,
					claimedById: interaction.user.id,
				}),
			],
			components: [closeButtonRow(ticketId, true)],
		});

		await channel.send(`<@${interaction.user.id}> prend en charge ce ticket.`);

		// Discord n'accepte que deux renommages par tranche de dix minutes :
		// le dire evite de chercher un bug la ou il n'y en a pas.
		if (!renomme) {
			await interaction.followUp({
				content:
					"Ticket pris en charge, mais Discord a refusé de renommer le salon (deux renommages par tranche de dix minutes).",
				flags: MessageFlags.Ephemeral,
			});
		}
		return;
	}

	if (action === "close") {
		await tickets.closeTicket(ticketId, interaction.user.id);
		const summary = await tickets.getTicketSummary(ticketId);
		if (!summary) return;

		await setOpenerAccess(channel, summary.openerId, false);
		await interaction.update({
			embeds: [
				closedEmbed({
					number: summary.number,
					subject: summary.subject,
					priority: summary.priority,
					openerId: summary.openerId,
					claimedById: summary.claimedByDiscordId,
				}),
			],
			components: [reopenDeleteButtonRow(ticketId)],
		});
		return;
	}

	if (action === "reopen") {
		await tickets.reopenTicket(ticketId, interaction.user.id);
		const summary = await tickets.getTicketSummary(ticketId);
		if (!summary) return;

		await setOpenerAccess(channel, summary.openerId, true);
		await interaction.update({
			embeds: [
				openEmbed({
					number: summary.number,
					subject: summary.subject,
					priority: summary.priority,
					openerId: summary.openerId,
					claimedById: summary.claimedByDiscordId,
				}),
			],
			components: [closeButtonRow(ticketId, Boolean(summary.claimedByDiscordId))],
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
				content: `Transcript du ticket #${summary.number} (${summary.subject})`,
				files: [
					{
						attachment: Buffer.from(transcript, "utf-8"),
						name: `ticket-${summary.number}.txt`,
					},
				],
			});
		} catch (err) {
			console.error("[Tickets] Envoi du transcript échoué :", err);
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
