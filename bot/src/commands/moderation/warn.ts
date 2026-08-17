import {
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import { WARNING_SEVERITY_LABELS, WarningSeverity } from "@anubis/shared";
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

const SEVERITY_CHOICES = Object.values(WarningSeverity).map((severity) => ({
	name: WARNING_SEVERITY_LABELS[severity],
	value: severity,
}));

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("warn")
		.setDescription("Avertir un membre.")
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Le membre à avertir.")
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("raison")
				.setDescription("Motif de l'avertissement.")
				.setMinLength(3)
				.setMaxLength(512)
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("severite")
				.setDescription("Gravite de l'avertissement.")
				.addChoices(...SEVERITY_CHOICES)
				.setRequired(false),
		)
		.addIntegerOption((option) =>
			option
				.setName("points")
				.setDescription("Poids dans le score (barème du serveur par défaut).")
				.setMinValue(1)
				.setMaxValue(100)
				.setRequired(false),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const responseEmbed = baseCommandEmbed("warn");

		if (
			!interaction.memberPermissions?.has(
				PermissionFlagsBits.ModerateMembers,
			)
		) {
			await repondreEchec(
				interaction,
				responseEmbed,
				"Tu n'as pas la permission d'avertir des membres.",
			);
			return;
		}

		const targetUser = interaction.options.getUser("membre", true);
		const reason = interaction.options.getString("raison", true);
		const severity = (interaction.options.getString("severite") ??
			WarningSeverity.LOW) as WarningSeverity;
		// `undefined` et non `1` : sans option, c'est le bareme du serveur qui
		// decide, pas une valeur codee ici.
		const points = interaction.options.getInteger("points") ?? undefined;

		const target = await interaction.guild.members
			.fetch(targetUser.id)
			.catch(() => null);
		if (target) {
			const issue = hierarchyIssue(interaction.member, target);
			if (issue) {
				await repondreEchec(interaction, responseEmbed, issue);
				return;
			}
		}

		await referentiel.upsertUser(interaction.user);
		await referentiel.upsertUser(targetUser);

		await moderation.createWarning({
			guildId: interaction.guildId,
			userId: targetUser.id,
			moderatorId: interaction.user.id,
			reason,
			severity,
			points,
		});

		if (target) {
			await notifyMember(
				target.user,
				`Tu as reçu un avertissement sur **${interaction.guild.name}**.\nMotif : ${reason}`,
			);
		}

		await repondreSucces(
			interaction,
			responseEmbed,
			`<@${targetUser.id}> a été averti (${WARNING_SEVERITY_LABELS[severity]}).\nMotif : ${reason}`,
		);
	},
};

export = command;
