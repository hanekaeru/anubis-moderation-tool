import {
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../../src/types";
import * as referentiel from "../../src/collectors/referentiel";
import * as moderation from "../../src/collectors/moderation";
import { baseCommandEmbed } from "../../src/utils/commandEmbed";
import * as colors from "../../utils/constantes";

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("unban")
		.setDescription("Lever le bannissement d'un membre.")
		.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription(
					"Le membre banni a debannir (identifiant Discord).",
				)
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("raison")
				.setDescription("Motif de la levee.")
				.setMinLength(3)
				.setMaxLength(500)
				.setRequired(true),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const responseEmbed = baseCommandEmbed("unban");

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
			responseEmbed
				.setDescription("Tu n'as pas la permission de debannir des membres.")
				.setColor(colors.danger);
			await interaction.reply({
				embeds: [responseEmbed],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const targetUser = interaction.options.getUser("membre", true);
		const reason = interaction.options.getString("raison", true);

		try {
			await interaction.guild.members.unban(targetUser, reason);
		} catch (err) {
			console.error("[Moderation] Levee de ban Discord echouee :", err);
			responseEmbed
				.setDescription(
					"La levée du bannissement a échoué côté Discord (le membre n'est peut-être pas banni).",
				)
				.setColor(colors.danger);
			await interaction.reply({
				embeds: [responseEmbed],
				flags: MessageFlags.Ephemeral,
			});
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
		responseEmbed
			.setDescription(`<@${targetUser.id}> a été débanni.${note}`)
			.setColor(colors.success);
		await interaction.reply({
			embeds: [responseEmbed],
			flags: MessageFlags.Ephemeral,
		});
	},
};

export = command;
