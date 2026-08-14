import {
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../../src/types";
import * as referentiel from "../../src/collectors/referentiel";
import * as moderation from "../../src/collectors/moderation";
import { baseCommandEmbed } from "../../src/utils/commandEmbed";
import { hierarchyIssue } from "../../src/utils/moderationGuard";
import { notifyMember } from "../../src/utils/notifyMember";
import * as colors from "../../utils/constantes";

const DELETE_MESSAGE_CHOICES = [
	{ name: "Aucun message", value: 0 },
	{ name: "1 heure", value: 60 * 60 },
	{ name: "6 heures", value: 6 * 60 * 60 },
	{ name: "12 heures", value: 12 * 60 * 60 },
	{ name: "1 jour", value: 24 * 60 * 60 },
	{ name: "3 jours", value: 3 * 24 * 60 * 60 },
	{ name: "7 jours", value: 7 * 24 * 60 * 60 },
];

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("ban")
		.setDescription("Bannir un membre du serveur (permanent).")
		.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Le membre a bannir.")
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("raison")
				.setDescription("Motif du bannissement.")
				.setMinLength(3)
				.setMaxLength(512)
				.setRequired(true),
		)
		.addIntegerOption((option) =>
			option
				.setName("supprimer_messages")
				.setDescription("Supprimer les messages recents de ce membre.")
				.addChoices(...DELETE_MESSAGE_CHOICES)
				.setRequired(false),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const responseEmbed = baseCommandEmbed("ban");

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
			responseEmbed
				.setDescription("Tu n'as pas la permission de bannir des membres.")
				.setColor(colors.danger);
			await interaction.reply({
				embeds: [responseEmbed],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const targetUser = interaction.options.getUser("membre", true);
		const reason = interaction.options.getString("raison", true);
		const deleteMessageSeconds =
			interaction.options.getInteger("supprimer_messages") ?? 0;

		const target = await interaction.guild.members
			.fetch(targetUser.id)
			.catch(() => null);
		if (target) {
			const issue = hierarchyIssue(interaction.member, target);
			if (issue) {
				responseEmbed.setDescription(issue).setColor(colors.danger);
				await interaction.reply({
					embeds: [responseEmbed],
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			if (!target.bannable) {
				responseEmbed
					.setDescription(
						"Je ne peux pas bannir ce membre (rôle trop haut ou permissions insuffisantes).",
					)
					.setColor(colors.danger);
				await interaction.reply({
					embeds: [responseEmbed],
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
		}

		await referentiel.upsertUser(interaction.user);
		await referentiel.upsertUser(targetUser);
		if (target) {
			await notifyMember(
				target.user,
				`Tu as ete banni de **${interaction.guild.name}**.\nMotif : ${reason}`,
			);
		}

		try {
			await interaction.guild.members.ban(targetUser, {
				reason,
				deleteMessageSeconds,
			});
		} catch (err) {
			console.error("[Moderation] Bannissement Discord echoue :", err);
			responseEmbed
				.setDescription("Le bannissement a échoué côté Discord.")
				.setColor(colors.danger);
			await interaction.reply({
				embeds: [responseEmbed],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await moderation.createSanction({
			guildId: interaction.guildId,
			userId: targetUser.id,
			moderatorId: interaction.user.id,
			type: "BAN",
			reason,
		});

		responseEmbed
			.setDescription(`<@${targetUser.id}> a été banni.\nMotif : ${reason}`)
			.setColor(colors.success);
		await interaction.reply({
			embeds: [responseEmbed],
			flags: MessageFlags.Ephemeral,
		});
	},
};

export = command;
