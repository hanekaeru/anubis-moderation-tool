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

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("kick")
		.setDescription("Expulser un membre du serveur.")
		.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Le membre a expulser.")
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("raison")
				.setDescription("Motif de l'expulsion.")
				.setMinLength(3)
				.setMaxLength(512)
				.setRequired(true),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const responseEmbed = baseCommandEmbed("kick");

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)) {
			responseEmbed
				.setDescription("Tu n'as pas la permission d'expulser des membres.")
				.setColor(colors.danger);
			await interaction.reply({
				embeds: [responseEmbed],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const targetUser = interaction.options.getUser("membre", true);
		const reason = interaction.options.getString("raison", true);

		const target = await interaction.guild.members
			.fetch(targetUser.id)
			.catch(() => null);
		if (!target) {
			responseEmbed
				.setDescription("Ce membre n'est pas sur ce serveur.")
				.setColor(colors.danger);
			await interaction.reply({
				embeds: [responseEmbed],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const issue = hierarchyIssue(interaction.member, target);
		if (issue) {
			responseEmbed.setDescription(issue).setColor(colors.danger);
			await interaction.reply({
				embeds: [responseEmbed],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!target.kickable) {
			responseEmbed
				.setDescription(
					"Je ne peux pas expulser ce membre (rôle trop haut ou permissions insuffisantes).",
				)
				.setColor(colors.danger);
			await interaction.reply({
				embeds: [responseEmbed],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await referentiel.upsertUser(interaction.user);
		await referentiel.upsertUser(target.user);
		await notifyMember(
			target.user,
			`Tu as ete expulse de **${interaction.guild.name}**.\nMotif : ${reason}`,
		);

		try {
			await target.kick(reason);
		} catch (err) {
			console.error("[Moderation] Expulsion Discord echouee :", err);
			responseEmbed
				.setDescription("L'expulsion a échoué côté Discord.")
				.setColor(colors.danger);
			await interaction.reply({
				embeds: [responseEmbed],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await moderation.createSanction({
			guildId: interaction.guildId,
			userId: target.id,
			moderatorId: interaction.user.id,
			type: "KICK",
			reason,
		});

		responseEmbed
			.setDescription(`<@${target.user.id}> a été expulsé.\nMotif : ${reason}`)
			.setColor(colors.success);
		await interaction.reply({
			embeds: [responseEmbed],
			flags: MessageFlags.Ephemeral,
		});
	},
};

export = command;
