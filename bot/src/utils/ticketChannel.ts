import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	EmbedBuilder,
	PermissionFlagsBits,
	type ColorResolvable,
	type Guild,
	type TextChannel,
} from "discord.js";
import {
	TICKET_PRIORITY_LABELS,
	TICKET_TRANSCRIPT_CHANNEL_CONFIG_KEY,
	TicketPriority,
	claimedTicketChannelName,
	newTicketChannelName,
} from "@anubis/shared";
import * as colors from "./constantes";
import * as guildConfig from "../collectors/guildConfig";

/**
 * Salons Discord d'un ticket : creation du salon prive, panneau de controle
 * (embed + boutons) et salon d'archive des transcripts.
 */

const TICKETS_CATEGORY_NAME = "Tickets";
const TRANSCRIPT_CHANNEL_NAME = "🎫-transcripts-tickets";

/** Rattachement Discord natif choisi pour l'acces staff : tout role portant
 * `ModerateMembers`, la meme permission deja verifiee par /warn, /ban... —
 * pas de role dedie a gerer en plus. */
export function moderatorRoleIds(guild: Guild): string[] {
	return guild.roles.cache
		.filter((role) => role.permissions.has(PermissionFlagsBits.ModerateMembers))
		.map((role) => role.id);
}

async function ensureTicketsCategory(guild: Guild) {
	const existing = guild.channels.cache.find(
		(channel) =>
			channel.type === ChannelType.GuildCategory &&
			channel.name.toLowerCase() === TICKETS_CATEGORY_NAME.toLowerCase(),
	);
	if (existing) return existing;

	return guild.channels.create({
		name: TICKETS_CATEGORY_NAME,
		type: ChannelType.GuildCategory,
	});
}

/** Cree le salon d'archive au premier besoin et persiste son id, comme le role de shadowban. */
export async function ensureTranscriptChannel(guild: Guild): Promise<TextChannel> {
	const existingId = await guildConfig.getConfig(
		guild.id,
		TICKET_TRANSCRIPT_CHANNEL_CONFIG_KEY,
	);
	if (existingId) {
		const existing = await guild.channels.fetch(existingId).catch(() => null);
		if (existing?.type === ChannelType.GuildText) return existing;
	}

	const parent = await ensureTicketsCategory(guild);
	const channel = await guild.channels.create({
		name: TRANSCRIPT_CHANNEL_NAME,
		type: ChannelType.GuildText,
		parent: parent.id,
		permissionOverwrites: [
			{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
			...moderatorRoleIds(guild).map((roleId) => ({
				id: roleId,
				allow: [PermissionFlagsBits.ViewChannel],
			})),
		],
	});

	await guildConfig.upsertConfig(
		guild.id,
		TICKET_TRANSCRIPT_CHANNEL_CONFIG_KEY,
		channel.id,
		"Salon d'archive des transcripts de tickets supprimés.",
	);

	return channel;
}

/**
 * Boutons d'un ticket ouvert.
 *
 * « Prendre le ticket » disparait une fois quelqu'un dessus : le bouton
 * n'aurait plus d'effet, et le laisser afficher inviterait a un clic qui
 * repartirait en erreur. Le nom du moderateur, lui, est dans l'embed.
 */
export function closeButtonRow(
	ticketId: string,
	claimed = false,
): ActionRowBuilder<ButtonBuilder> {
	const row = new ActionRowBuilder<ButtonBuilder>();

	if (!claimed) {
		row.addComponents(
			new ButtonBuilder()
				.setCustomId(`ticket:claim:${ticketId}`)
				.setLabel("Prendre le ticket")
				.setEmoji("🙋")
				.setStyle(ButtonStyle.Success),
		);
	}

	return row.addComponents(
		new ButtonBuilder()
			.setCustomId(`ticket:close:${ticketId}`)
			.setLabel("Fermer le ticket")
			.setEmoji("🔒")
			.setStyle(ButtonStyle.Danger),
	);
}

export function reopenDeleteButtonRow(ticketId: string): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`ticket:reopen:${ticketId}`)
			.setLabel("Rouvrir")
			.setEmoji("🔓")
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId(`ticket:delete:${ticketId}`)
			.setLabel("Supprimer")
			.setEmoji("🗑️")
			.setStyle(ButtonStyle.Danger),
	);
}

/** Couleur de l'embed selon la gravite : le staff trie a l'oeil. */
function priorityColor(priority: TicketPriority): ColorResolvable {
	if (priority === TicketPriority.URGENT) return colors.danger;
	if (priority === TicketPriority.HIGH) return colors.warning;
	return colors.info;
}

export interface TicketEmbedState {
	number: number;
	subject: string;
	priority: TicketPriority;
	openerId: string;
	/** Description libre saisie a l'ouverture. */
	description?: string | null;
	/** Moderateur Discord qui a pris le ticket. */
	claimedById?: string | null;
}

export function openEmbed(state: TicketEmbedState): EmbedBuilder {

	const embed = new EmbedBuilder()
		.setColor(priorityColor(state.priority))
		.setTitle(`Ticket #${state.number} — ${state.subject}`)
		.setDescription(
			`Bienvenue <@${state.openerId}>, l'équipe de va prendre en charge ta demande.`,
		)
		.addFields({
			name: "Gravité",
			value: TICKET_PRIORITY_LABELS[state.priority],
			inline: true,
		})
		.setTimestamp();

	embed.addFields({
		name: "Prise en charge",
		value: state.claimedById ? `<@${state.claimedById}>` : "En attente d'un modérateur",
		inline: true,
	});

	if (state.description) {
		embed.addFields({ name: "Demande", value: state.description.slice(0, 1024) });
	}

	return embed;
}

export function closedEmbed(state: TicketEmbedState): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(colors.warning)
		.setTitle(`Ticket #${state.number} — ${state.subject} (fermé)`)
		.setDescription(
			"Ce ticket est fermé. Un membre du staff peut le rouvrir ou le supprimer.",
		)
		.setTimestamp();

	if (state.claimedById) {
		embed.addFields({ name: "Pris en charge par", value: `<@${state.claimedById}>` });
	}

	return embed;
}

interface CreateTicketChannelInput {
	guild: Guild;
	ticketId: string;
	state: TicketEmbedState;
}

export async function createTicketChannel(
	input: CreateTicketChannelInput,
): Promise<TextChannel> {
	const { guild, ticketId, state } = input;
	const openerId = state.openerId;
	const parent = await ensureTicketsCategory(guild);

	const channel = await guild.channels.create({
		name: newTicketChannelName(state.number),
		type: ChannelType.GuildText,
		parent: parent.id,
		permissionOverwrites: [
			{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
			{
				id: openerId,
				allow: [
					PermissionFlagsBits.ViewChannel,
					PermissionFlagsBits.SendMessages,
					PermissionFlagsBits.ReadMessageHistory,
					PermissionFlagsBits.AttachFiles,
				],
			},
			...moderatorRoleIds(guild).map((roleId) => ({
				id: roleId,
				allow: [
					PermissionFlagsBits.ViewChannel,
					PermissionFlagsBits.SendMessages,
					PermissionFlagsBits.ReadMessageHistory,
				],
			})),
		],
	});

	await channel.send({
		embeds: [openEmbed(state)],
		components: [closeButtonRow(ticketId)],
	});

	return channel;
}

/**
 * Renomme le salon aux couleurs du moderateur qui vient de prendre le ticket.
 *
 * Discord n'accepte que **deux renommages par tranche de dix minutes et par
 * salon** : c'est pourquoi la prise en charge est refusee quand quelqu'un est
 * deja dessus, et pourquoi rien d'autre ne renomme un salon de ticket.
 */
export async function renameForClaim(
	channel: TextChannel,
	prefix: string,
	openerUsername: string,
	number: number,
): Promise<boolean> {
	try {
		await channel.setName(
			claimedTicketChannelName(prefix, openerUsername, number),
			"Ticket pris en charge.",
		);
		return true;
	} catch (err) {
		console.error("[Tickets] Renommage du salon échoué :", err);
		return false;
	}
}

/**
 * Acces de l'ouvreur au salon de son ticket.
 *
 * Un ticket ferme **disparait de sa liste de salons** : `ViewChannel` tombe
 * avec `SendMessages`. Le laisser lire jusqu'a la suppression du salon
 * revenait a garder ouvert, du point de vue du membre, un ticket que le staff
 * considere clos — et a laisser trainer la conversation sous ses yeux le temps
 * que quelqu'un pense a supprimer le salon. Le transcript, lui, reste au
 * staff.
 *
 * La reouverture rend les deux droits.
 */
export async function setOpenerAccess(
	channel: TextChannel,
	openerId: string,
	granted: boolean,
): Promise<void> {
	await channel.permissionOverwrites.edit(openerId, {
		ViewChannel: granted,
		SendMessages: granted,
		ReadMessageHistory: granted,
	});
}
