import {
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import {
	DURATION_UNIT_CHOICES_TIMED,
	DURATION_UNIT_LABELS,
	DurationUnit,
	durationToSeconds,
	MAX_TIMEOUT_SECONDS,
} from "@anubis/shared";
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
import { formatDuration } from "../../utils/formatDuration";
import * as colors from "../../utils/constantes";

const UNIT_CHOICES = DURATION_UNIT_CHOICES_TIMED.map((unit) => ({
	name: DURATION_UNIT_LABELS[unit],
	value: unit,
}));

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("mute")
		.setDescription("Exclure temporairement un membre (timeout Discord).")
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Le membre à exclure temporairement.")
				.setRequired(true),
		)
		.addIntegerOption((option) =>
			option
				.setName("duree")
				.setDescription("Durée de l'exclusion.")
				.setMinValue(1)
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("unite")
				.setDescription("Unité de la durée.")
				.addChoices(...UNIT_CHOICES)
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("raison")
				.setDescription("Motif de l'exclusion.")
				.setMinLength(3)
				.setMaxLength(512)
				.setRequired(true),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const responseEmbed = baseCommandEmbed("mute");

		if (
			!interaction.memberPermissions?.has(
				PermissionFlagsBits.ModerateMembers,
			)
		) {
			await repondreEchec(
				interaction,
				responseEmbed,
				`Tu n'as pas la permission de mute temporairement des membres.`,
			);
			return;
		}

		const targetUser = interaction.options.getUser("membre", true);
		const amount = interaction.options.getInteger("duree", true);
		const unit = interaction.options.getString(
			"unite",
			true,
		) as DurationUnit;
		const reason = interaction.options.getString("raison", true);

		const durationSeconds = durationToSeconds(amount, unit);
		if (durationSeconds === null || durationSeconds > MAX_TIMEOUT_SECONDS) {
			await repondreEchec(
				interaction,
				responseEmbed,
				`Un timeout Discord ne peut pas dépasser 28 jours. Utilise \`/shadowban\` pour une restriction plus longue ou permanente.`,
			);
			return;
		}

		const target = await interaction.guild.members
			.fetch(targetUser.id)
			.catch(() => null);
		if (!target) {
			await repondreEchec(
				interaction,
				responseEmbed,
				`Ce membre n'est pas sur ce serveur.`,
			);
			return;
		}

		const issue = hierarchyIssue(interaction.member, target);
		if (issue) {
			await repondreEchec(interaction, responseEmbed, issue);
			return;
		}

		if (!target.moderatable) {
			await repondreEchec(
				interaction,
				responseEmbed,
				`Je ne peux pas exclure ce membre (rôle trop haut ou permissions insuffisantes).`,
			);
			return;
		}

		await referentiel.upsertUser(interaction.user);
		await referentiel.upsertUser(target.user);
		await notifyMember(
			target.user,
			`Tu as été exclu temporairement de **${interaction.guild.name}**.\nMotif : ${reason}\nDurée : ${formatDuration(amount, unit)}`,
		);

		try {
			await target.timeout(durationSeconds * 1000, reason);
		} catch (err) {
			console.error("[Modération] Timeout Discord échoué :", err);
			await repondreEchec(
				interaction,
				responseEmbed,
				`L'exclusion temporaire a échoué. Le problème venant de Discord.`,
			);
			return;
		}

		await moderation.createSanction({
			guildId: interaction.guildId,
			userId: target.id,
			moderatorId: interaction.user.id,
			type: "TIMEOUT",
			reason,
			durationSeconds,
		});

		await repondreSucces(
			interaction,
			responseEmbed,
			`<@${target.user.id}> est exclu temporairement. \nDurée : ${formatDuration(amount, unit)}\nMotif : ${reason}`,
		);
	},
};

export = command;
