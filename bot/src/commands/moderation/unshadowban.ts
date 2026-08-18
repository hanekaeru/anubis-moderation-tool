import {
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../../types";
import * as referentiel from "../../collectors/referentiel";
import * as moderation from "../../collectors/moderation";
import * as shadowbanRole from "../../collectors/shadowbanRole";
import {
	baseCommandEmbed,
	repondreEchec,
	repondreSucces,
} from "../../utils/commandEmbed";
import { notifyMember } from "../../utils/notifyMember";

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
			await repondreEchec(
				interaction,
				responseEmbed,
				"Tu n'as pas la permission de lever une restriction d'accès.",
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

		let rendus: string[];
		try {
			rendus = await shadowbanRole.liftShadowban(target, reason);
		} catch (err) {
			console.error("[Shadowban] Levée du rôle échouée :", err);
			await repondreEchec(
				interaction,
				responseEmbed,
				"La levée de la restriction a échoué côté Discord.",
			);
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
		const roles = rendus.length ? `\nRôles rendus : ${rendus.length}` : "";

		await repondreSucces(
			interaction,
			responseEmbed,
			`La restriction de <@${target.user.id}> a été levée.${roles}${note}`,
		);
	},
};

export = command;
