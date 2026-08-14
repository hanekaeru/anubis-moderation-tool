import {
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../../src/types";
import * as referentiel from "../../src/collectors/referentiel";
import * as moderation from "../../src/collectors/moderation";
import * as shadowbanRole from "../../src/collectors/shadowbanRole";
import { baseCommandEmbed } from "../../src/utils/commandEmbed";
import { notifyMember } from "../../src/utils/notifyMember";
import * as colors from "../../utils/constantes";

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("unshadowban")
		.setDescription(
			"Lever la restriction d'accès d'un membre avant son expiration.",
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription(
					"Le membre dont la restriction doit être levée.",
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

		const responseEmbed = baseCommandEmbed("unshadowban");

		if (
			!interaction.memberPermissions?.has(
				PermissionFlagsBits.ModerateMembers,
			)
		) {
			responseEmbed
				.setDescription(
					"Tu n'as pas la permission de lever une restriction d'accès.",
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
			await shadowbanRole.liftShadowban(target, reason);
		} catch (err) {
			console.error("[Shadowban] Levée du rôle échouée :", err);
			responseEmbed
				.setDescription("La levée de la restriction a échoué côté Discord.")
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
			"SHADOWBAN",
			interaction.user.id,
			reason,
		);

		await notifyMember(
			target.user,
			`La restriction de ton accès à **${interaction.guild.name}** a été levée.\nMotif : ${reason}`,
		);

		const note = revoked
			? ""
			: "\n(aucune restriction active trouvée en base, le rôle a quand même été retiré)";
		responseEmbed
			.setDescription(`La restriction de <@${target.user.id}> a été levée.${note}`)
			.setColor(colors.success);
		await interaction.reply({
			embeds: [responseEmbed],
			flags: MessageFlags.Ephemeral,
		});
	},
};

export = command;
