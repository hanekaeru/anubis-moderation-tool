import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../../types";
import { TICKET_OPEN_BUTTON } from "../../handlers/ticketInteractions";
import { ensureTranscriptChannel } from "../../utils/ticketChannel";
import * as colors from "../../utils/constantes";

/**
 * Poste le panneau d'ouverture de ticket (embed + bouton) dans le salon
 * choisi, et prepare le salon d'archive des transcripts s'il n'existe pas
 * encore. Le bouton est ecoute par `src/handlers/ticketInteractions.ts` via
 * son customId `ticket:open`.
 *
 * Un **bouton** et non un select : le sujet et la gravite se choisissent dans
 * une modale, et `showModal` est refuse apres l'accuse de reception qui serait
 * necessaire pour remettre un select a sa place. Le panneau doit donc etre
 * repose apres mise a jour du bot — les anciens panneaux, eux, ne repondent
 * plus.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("create_ticket_panel")
		.setDescription("ADMIN - Poste le panneau d'ouverture de ticket dans un salon.")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addChannelOption((option) =>
			option
				.setName("salon")
				.setDescription("Salon ou poster le panneau de tickets.")
				.addChannelTypes(ChannelType.GuildText)
				.setRequired(true),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		if (
			!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
		) {
			await interaction.reply({
				content: "Tu n'as pas la permission de configurer le serveur.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const target = interaction.options.getChannel("salon", true);
		const channel = await interaction.guild.channels.fetch(target.id);
		if (!channel || channel.type !== ChannelType.GuildText) {
			await interaction.reply({
				content: "Salon invalide.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		await ensureTranscriptChannel(interaction.guild);

		const bouton = new ButtonBuilder()
			.setCustomId(TICKET_OPEN_BUTTON)
			.setLabel("Ouvrir un ticket")
			.setEmoji("🎫")
			.setStyle(ButtonStyle.Primary);

		const embed = new EmbedBuilder()
			.setColor(colors.info)
			.setTitle("Support")
			.setDescription(
				`Bienvenue sur le support du serveur ! Si jamais tu as besoin d'ouvrir un ticket (que ce soit
				pour un bug, un membre à signaler ou une simple remarque), tu peux le faire via le bouton
				ci-dessous. Choisis un sujet et une gravité, et un ticket sera ouvert directement avec
				l'équipe de modération. Elle fera de son mieux pour t'aider et te guider !`,
			);

		await channel.send({
			embeds: [embed],
			components: [new ActionRowBuilder<ButtonBuilder>().addComponents(bouton)],
		});

		await interaction.editReply({
			content: `Panneau de tickets posté dans ${channel}.`,
		});
	},
};

export = command;
