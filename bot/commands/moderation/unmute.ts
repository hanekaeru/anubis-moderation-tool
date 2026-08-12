import {
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../../src/types";
import * as referentiel from "../../src/collectors/referentiel";
import * as moderation from "../../src/collectors/moderation";
import { notifyMember } from "../../src/utils/notifyMember";

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

		if (
			!interaction.memberPermissions?.has(
				PermissionFlagsBits.ModerateMembers,
			)
		) {
			await interaction.reply({
				content:
					"Tu n'as pas la permission de lever une exclusion temporaire.",
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

		try {
			await target.timeout(null, reason);
		} catch (err) {
			console.error(
				"[Moderation] Levee du timeout Discord echouee :",
				err,
			);
			await interaction.reply({
				content: "La levee de l'exclusion a echoue cote Discord.",
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
			: " (aucune exclusion active trouvee en base, le timeout Discord a quand meme ete leve)";
		await interaction.reply({
			content: `L'exclusion de ${target.user.tag} a ete levee.${note}`,
			flags: MessageFlags.Ephemeral,
		});
	},
};

export = command;
