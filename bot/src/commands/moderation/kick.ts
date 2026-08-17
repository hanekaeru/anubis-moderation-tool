import {
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../../types";
import * as referentiel from "../../collectors/referentiel";
import * as moderation from "../../collectors/moderation";
import {
	baseCommandEmbed,
	repondreEchec,
	repondreSucces,
} from "../../utils/commandEmbed";
import { hierarchyIssue } from "../../utils/moderationGuard";
import { notifyMember } from "../../utils/notifyMember";

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("kick")
		.setDescription("Expulser un membre du serveur.")
		.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Le membre à expulser.")
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
			await repondreEchec(
				interaction,
				responseEmbed,
				"Tu n'as pas la permission d'expulser des membres.",
			);
			return;
		}

		const targetUser = interaction.options.getUser("membre", true);
		const reason = interaction.options.getString("raison", true);

		const target = await interaction.guild.members
			.fetch(targetUser.id)
			.catch(() => null);
		if (!target) {
			await repondreEchec(
				interaction,
				responseEmbed,
				"Ce membre n'est pas sur ce serveur.",
			);
			return;
		}

		const issue = hierarchyIssue(interaction.member, target);
		if (issue) {
			await repondreEchec(interaction, responseEmbed, issue);
			return;
		}

		if (!target.kickable) {
			await repondreEchec(
				interaction,
				responseEmbed,
				"Je ne peux pas expulser ce membre (rôle trop haut ou permissions insuffisantes).",
			);
			return;
		}

		await referentiel.upsertUser(interaction.user);
		await referentiel.upsertUser(target.user);
		await notifyMember(
			target.user,
			`Tu as été expulsé de **${interaction.guild.name}**.\nMotif : ${reason}`,
		);

		try {
			await target.kick(reason);
		} catch (err) {
			console.error("[Modération] Expulsion Discord échouée :", err);
			await repondreEchec(
				interaction,
				responseEmbed,
				"L'expulsion a échoué côté Discord.",
			);
			return;
		}

		await moderation.createSanction({
			guildId: interaction.guildId,
			userId: target.id,
			moderatorId: interaction.user.id,
			type: "KICK",
			reason,
		});

		await repondreSucces(
			interaction,
			responseEmbed,
			`<@${target.user.id}> a été expulsé.\nMotif : ${reason}`,
		);
	},
};

export = command;
