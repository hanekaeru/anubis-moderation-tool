import {
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import {
	DURATION_UNIT_CHOICES_WITH_PERMANENT,
	DURATION_UNIT_LABELS,
	DurationUnit,
	durationToSeconds,
} from "@anubis/shared";
import type { Command } from "../../types";
import * as referentiel from "../../collectors/referentiel";
import * as moderation from "../../collectors/moderation";
import * as shadowbanRole from "../../collectors/shadowbanRole";
import {
	baseCommandEmbed,
	repondreEchec,
	repondreSucces,
} from "../../utils/commandEmbed";
import { hierarchyIssue } from "../../utils/moderationGuard";
import { notifyMember } from "../../utils/notifyMember";
import { formatDuration } from "../../utils/formatDuration";
import * as colors from "../../utils/constantes";

const UNIT_CHOICES = DURATION_UNIT_CHOICES_WITH_PERMANENT.map((unit) => ({
	name: DURATION_UNIT_LABELS[unit],
	value: unit,
}));

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("shadowban")
		.setDescription(
			"Restreindre l'accès d'un membre via un rôle dédié (peut être permanent).",
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Le membre dont l'accès doit être restreint.")
				.setRequired(true),
		)
		.addIntegerOption((option) =>
			option
				.setName("duree")
				.setDescription(
					"Durée de la restriction (ignorée si unité = Permanent).",
				)
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
				.setDescription("Motif de la réstriction.")
				.setMinLength(3)
				.setMaxLength(512)
				.setRequired(true),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const responseEmbed = baseCommandEmbed("shadowban");

		if (
			!interaction.memberPermissions?.has(
				PermissionFlagsBits.ModerateMembers,
			)
		) {
			await repondreEchec(
				interaction,
				responseEmbed,
				`Tu n'as pas la permission de restreindre l'accès aux membres.`,
			);
			return;
		}

		if (
			!interaction.guild.members.me?.permissions.has(
				PermissionFlagsBits.ManageRoles,
			)
		) {
			await repondreEchec(
				interaction,
				responseEmbed,
				`Je n'ai pas la permission de gérer les rôles de ce serveur.`,
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

		const target = await interaction.guild.members
			.fetch(targetUser.id)
			.catch(() => null);
		if (!target) {
			await repondreEchec(
				interaction,
				responseEmbed,
				`Ce membre n'est pas sur le serveur.`,
			);
			return;
		}

		const issue = hierarchyIssue(interaction.member, target);
		if (issue) {
			await repondreEchec(interaction, responseEmbed, issue);
			return;
		}

		const durationSeconds = durationToSeconds(amount, unit);

		await referentiel.upsertUser(interaction.user);
		await referentiel.upsertUser(target.user);

		try {
			await shadowbanRole.applyShadowban(target, reason);
		} catch (err) {
			console.error("[Shadowban] Attribution du rôle échouée :", err);
			await repondreEchec(
				interaction,
				responseEmbed,
				"Le shadowban a échoué (rôle trop haut ou permissions insuffisantes).",
			);
			return;
		}

		await notifyMember(
			target.user,
			`Ton accès à **${interaction.guild.name}** a été restreint.\nMotif : ${reason}\nDurée : ${formatDuration(amount, unit)}`,
		);

		await moderation.createSanction({
			guildId: interaction.guildId,
			userId: target.id,
			moderatorId: interaction.user.id,
			type: "SHADOWBAN",
			reason,
			durationSeconds,
		});

		await repondreSucces(
			interaction,
			responseEmbed,
			`<@${target.user.id}> est shadowban. \nDurée : ${formatDuration(amount, unit)}\nMotif : ${reason}`,
		);
	},
};

export = command;
