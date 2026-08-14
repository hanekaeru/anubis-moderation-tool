import {
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../../src/types";
import * as referentiel from "../../src/collectors/referentiel";
import * as moderation from "../../src/collectors/moderation";
import { baseCommandEmbed } from "../../src/utils/commandEmbed";
import { notifyMember } from "../../src/utils/notifyMember";
import * as colors from "../../utils/constantes";

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
				.setDescription("Le membre dont l'exclusion doit etre levee.")
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

		const responseEmbed = baseCommandEmbed("unmute");

		if (
			!interaction.memberPermissions?.has(
				PermissionFlagsBits.ModerateMembers,
			)
		) {
			responseEmbed
				.setDescription(
					"Tu n'as pas la permission de lever une exclusion temporaire.",
				)
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

		try {
			await target.timeout(null, reason);
		} catch (err) {
			console.error("[Moderation] Levee du timeout Discord echouee :", err);
			responseEmbed
				.setDescription("La levée de l'exclusion a échoué côté Discord.")
				.setColor(colors.danger);
			await interaction.reply({
				embeds: [responseEmbed],
				flags: MessageFlags.Ephemeral,
			});
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
			`Ton exclusion temporaire sur **${interaction.guild.name}** a ete levee.\nMotif : ${reason}`,
		);

		const note = revoked
			? ""
			: "\n(aucune exclusion active trouvée en base, le timeout Discord a quand même été levé)";
		responseEmbed
			.setDescription(`L'exclusion de <@${target.user.id}> a été levée.${note}`)
			.setColor(colors.success);
		await interaction.reply({
			embeds: [responseEmbed],
			flags: MessageFlags.Ephemeral,
		});
	},
};

export = command;
