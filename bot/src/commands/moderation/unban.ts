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

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("unban")
		.setDescription("Lever le bannissement d'un membre.")
		.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription(
					"Le membre banni à débannir (identifiant Discord).",
				)
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

		const responseEmbed = baseCommandEmbed("unban");

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
			await repondreEchec(
				interaction,
				responseEmbed,
				"Tu n'as pas la permission de débannir des membres.",
			);
			return;
		}

		const targetUser = interaction.options.getUser("membre", true);
		const reason = interaction.options.getString("raison", true);

		try {
			await interaction.guild.members.unban(targetUser, reason);
		} catch (err) {
			console.error("[Modération] Levée de ban Discord échouée :", err);
			await repondreEchec(
				interaction,
				responseEmbed,
				"La levée du bannissement a échoué côté Discord (le membre n'est peut-être pas banni).",
			);
			return;
		}

		await referentiel.upsertUser(interaction.user);
		await referentiel.upsertUser(targetUser);

		const revoked = await moderation.revokeActiveSanction(
			interaction.guildId,
			targetUser.id,
			"BAN",
			interaction.user.id,
			reason,
		);

		const note = revoked
			? ""
			: "\n(aucun bannissement actif trouvé en base, le ban Discord a quand même été levé)";
		await repondreSucces(
			interaction,
			responseEmbed,
			`<@${targetUser.id}> a été débanni.${note}`,
		);
	},
};

export = command;
