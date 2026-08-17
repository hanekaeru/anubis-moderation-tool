import {
	ActionRowBuilder,
	ChannelType,
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	StringSelectMenuBuilder,
} from "discord.js";
import { TICKET_CATEGORY_LABELS, TicketCategory } from "@anubis/shared";
import type { Command } from "../../types";
import { ensureTranscriptChannel } from "../../utils/ticketChannel";
import * as colors from "../../utils/constantes";

/**
 * Poste le panneau d'ouverture de ticket (embed + select menu des raisons)
 * dans le salon choisi, et prepare le salon d'archive des transcripts s'il
 * n'existe pas encore. Le select menu est ecoute par
 * `src/handlers/ticketInteractions.ts` via son customId `ticket:open`.
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

		const select = new StringSelectMenuBuilder()
			.setCustomId("ticket:open")
			.setPlaceholder("Choisis la raison de ton ticket")
			.addOptions(
				Object.values(TicketCategory).map((category) => ({
					label: TICKET_CATEGORY_LABELS[category],
					value: category,
				})),
			);

		const embed = new EmbedBuilder()
			.setColor(colors.info)
			.setTitle("Support")
			.setDescription(
				"Sélectionne une raison ci-dessous pour ouvrir un ticket privé avec l'équipe.",
			);

		await channel.send({
			embeds: [embed],
			components: [
				new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
			],
		});

		await interaction.editReply({
			content: `Panneau de tickets poste dans ${channel}.`,
		});
	},
};

export = command;
