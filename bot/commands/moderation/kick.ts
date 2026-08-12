import {
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../../src/types";
import * as referentiel from "../../src/collectors/referentiel";
import * as moderation from "../../src/collectors/moderation";
import { hierarchyIssue } from "../../src/utils/moderationGuard";
import { notifyMember } from "../../src/utils/notifyMember";

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

		if (
			!interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)
		) {
			await interaction.reply({
				content: "Tu n'as pas la permission d'expulser des membres.",
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
			await interaction.reply({
				content: "Ce membre n'est pas sur ce serveur.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const issue = hierarchyIssue(interaction.member, target);
		if (issue) {
			await interaction.reply({
				content: issue,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!target.kickable) {
			await interaction.reply({
				content:
					"Je ne peux pas expulser ce membre (role trop haut ou permissions insuffisantes).",
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
			await interaction.reply({
				content: "L'expulsion a echoue cote Discord.",
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

		await interaction.reply({
			content: `${target.user.tag} a ete expulse. Motif : ${reason}`,
			flags: MessageFlags.Ephemeral,
		});
	},
};

export = command;
