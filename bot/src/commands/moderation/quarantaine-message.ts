import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import {
	DEFAULT_QUARANTINE_BATTLENET_MESSAGE,
	DEFAULT_QUARANTINE_MESSAGE,
} from "@anubis/shared";
import prisma from "../../prisma";
import type { Command } from "../../types";
import {
	QUARANTINE_ACCEPT_ID,
	QUARANTINE_BATTLENET_ID,
} from "../../handlers/quarantineInteractions";
import * as colors from "../../utils/constantes";

/**
 * Publie le message de reglement et son bouton d'acceptation.
 *
 * Tout le contenu vient de `QuarantineConfig`, reglee depuis le dashboard :
 * salon, texte et libelle du bouton. La commande ne fait que (re)poster —
 * rejouable a volonte, par exemple apres une modification du reglement.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("quarantaine-message")
		.setDescription(
			"MOD - (Re)poste le message de règlement de la quarantaine dans le salon configuré.",
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
			await interaction.reply({
				content: "Tu n'as pas la permission de gérer la quarantaine.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const config = await prisma.quarantineConfig.findUnique({
			where: { guildId: interaction.guildId },
		});

		if (!config?.enabled) {
			await interaction.editReply({
				content:
					"La quarantaine est désactivée. Active-la depuis le dashboard avant de poster le message.",
			});
			return;
		}

		if (!config.roleId || !config.channelId) {
			await interaction.editReply({
				content:
					"Le rôle de quarantaine ou le salon du règlement n'est pas configuré dans le dashboard.",
			});
			return;
		}

		const channel = await interaction.guild.channels
			.fetch(config.channelId)
			.catch(() => null);

		if (!channel?.isTextBased()) {
			await interaction.editReply({
				content: "Le salon configuré est introuvable ou n'accepte pas de messages.",
			});
			return;
		}

		const embed = new EmbedBuilder()
			.setColor(colors.info)
			.setTitle("Règlement du serveur")
			.setDescription(config.message ?? DEFAULT_QUARANTINE_MESSAGE);

		const boutons = [
			new ButtonBuilder()
				.setCustomId(QUARANTINE_ACCEPT_ID)
				.setLabel(config.buttonLabel)
				.setStyle(ButtonStyle.Success),
		];

		// Le second bouton n'apparait que si la verification est exigee : un bouton
		// qui repond « ce n'est pas demande ici » ne rend service a personne.
		if (config.battlenetRequired) {
			embed.addFields({
				name: "Vérification du compte",
				value: config.battlenetMessage ?? DEFAULT_QUARANTINE_BATTLENET_MESSAGE,
			});

			boutons.push(
				new ButtonBuilder()
					.setCustomId(QUARANTINE_BATTLENET_ID)
					.setLabel(config.battlenetButtonLabel)
					.setStyle(ButtonStyle.Primary),
			);
		}

		await channel.send({
			embeds: [embed],
			components: [
				new ActionRowBuilder<ButtonBuilder>().addComponents(boutons),
			],
		});

		await interaction.editReply({
			content: `Message de quarantaine posté dans ${channel}.`,
		});
	},
};

export = command;
