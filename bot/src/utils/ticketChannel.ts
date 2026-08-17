import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	EmbedBuilder,
	PermissionFlagsBits,
	type Guild,
	type TextChannel,
} from "discord.js";
import { TICKET_TRANSCRIPT_CHANNEL_CONFIG_KEY } from "@anubis/shared";
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

export function closeButtonRow(ticketId: string): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
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

export function openEmbed(
	number: number,
	categoryLabel: string,
	openerId: string,
): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(colors.info)
		.setTitle(`Ticket #${number} — ${categoryLabel}`)
		.setDescription(`Bienvenue <@${openerId}>, l'équipe va prendre en charge ta demande.`)
		.setTimestamp();
}

export function closedEmbed(number: number, categoryLabel: string): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(colors.warning)
		.setTitle(`Ticket #${number} — ${categoryLabel} (fermé)`)
		.setDescription("Ce ticket est fermé. Un membre du staff peut le rouvrir ou le supprimer.")
		.setTimestamp();
}

interface CreateTicketChannelInput {
	guild: Guild;
	openerId: string;
	ticketId: string;
	number: number;
	categoryLabel: string;
}

export async function createTicketChannel(
	input: CreateTicketChannelInput,
): Promise<TextChannel> {
	const { guild, openerId, ticketId, number, categoryLabel } = input;
	const parent = await ensureTicketsCategory(guild);

	const channel = await guild.channels.create({
		name: `ticket-${String(number).padStart(4, "0")}`,
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
		embeds: [openEmbed(number, categoryLabel, openerId)],
		components: [closeButtonRow(ticketId)],
	});

	return channel;
}

/** Lecture seule pour l'ouvreur une fois le ticket ferme, ecriture retablie a la reouverture. */
export async function setOpenerCanWrite(
	channel: TextChannel,
	openerId: string,
	canWrite: boolean,
): Promise<void> {
	await channel.permissionOverwrites.edit(openerId, { SendMessages: canWrite });
}
