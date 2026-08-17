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
				.setDescription("Le membre à bannir.")
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
				.setDescription("Supprimer les messages récents de ce membre.")
				.addChoices(...DELETE_MESSAGE_CHOICES)
				.setRequired(false),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const responseEmbed = baseCommandEmbed("ban");

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
			await repondreEchec(
				interaction,
				responseEmbed,
				"Tu n'as pas la permission de bannir des membres.",
			);
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
				await repondreEchec(interaction, responseEmbed, issue);
				return;
			}

			if (!target.bannable) {
				await repondreEchec(
					interaction,
					responseEmbed,
					"Je ne peux pas bannir ce membre (rôle trop haut ou permissions insuffisantes).",
				);
				return;
			}
		}

		await referentiel.upsertUser(interaction.user);
		await referentiel.upsertUser(targetUser);
		if (target) {
			await notifyMember(
				target.user,
				`Tu as été banni de **${interaction.guild.name}**.\nMotif : ${reason}`,
			);
		}

		try {
			await interaction.guild.members.ban(targetUser, {
				reason,
				deleteMessageSeconds,
			});
		} catch (err) {
			console.error("[Modération] Bannissement Discord échoué :", err);
			await repondreEchec(
				interaction,
				responseEmbed,
				"Le bannissement a échoué côté Discord.",
			);
			return;
		}

		await moderation.createSanction({
			guildId: interaction.guildId,
			userId: targetUser.id,
			moderatorId: interaction.user.id,
			type: "BAN",
			reason,
		});

		await repondreSucces(
			interaction,
			responseEmbed,
			`<@${targetUser.id}> a été banni.\nMotif : ${reason}`,
		);
	},
};

export = command;
