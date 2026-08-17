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
import { notifyMember } from "../../utils/notifyMember";

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("unmute")
		.setDescription(
			"Lever l'exclusion temporaire d'un membre avant son expiration.",
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Le membre dont l'exclusion doit être levée.")
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("raison")
				.setDescription("Motif de la levée.")
				.setMinLength(3)
				.setMaxLength(500)
				.setRequired(true),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const responseEmbed = baseCommandEmbed("unmute");

		if (
			!interaction.memberPermissions?.has(
				PermissionFlagsBits.ModerateMembers,
			)
		) {
			await repondreEchec(
				interaction,
				responseEmbed,
				"Tu n'as pas la permission de lever une exclusion temporaire.",
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

		try {
			await target.timeout(null, reason);
		} catch (err) {
			console.error("[Modération] Levée du timeout Discord échouée :", err);
			await repondreEchec(
				interaction,
				responseEmbed,
				"La levée de l'exclusion a échoué côté Discord.",
			);
			return;
		}

		await referentiel.upsertUser(interaction.user);
		await referentiel.upsertUser(target.user);

		const revoked = await moderation.revokeActiveSanction(
			interaction.guildId,
			target.id,
			"TIMEOUT",
			interaction.user.id,
			reason,
		);

		await notifyMember(
			target.user,
			`Ton exclusion temporaire sur **${interaction.guild.name}** a été levée.\nMotif : ${reason}`,
		);

		const note = revoked
			? ""
			: "\n(aucune exclusion active trouvée en base, le timeout Discord a quand même été levé)";
		await repondreSucces(
			interaction,
			responseEmbed,
			`L'exclusion de <@${target.user.id}> a été levée.${note}`,
		);
	},
};

export = command;
