import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types";
import * as voiceHubs from "../../collectors/voiceHubs";

/**
 * Supprime tous les salons vocaux temporaires encore ouverts.
 *
 * Filet de secours si le bot laisse trainer des salons — jamais les salons de
 * creation, qui relevent de `/delete_parties`. Les membres encore connectes
 * sont simplement deconnectes par Discord a la suppression du salon.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("purge_vocaux")
		.setDescription(
			"ADMIN - Supprime les salons vocaux temporaires créés par les membres.",
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
			await interaction.reply({
				content: "Tu n'as pas la permission de configurer le serveur.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const supprimes = await voiceHubs.purgerSalonsTemporaires(interaction.guild);

		await interaction.editReply({
			content: supprimes
				? `${supprimes} salon(s) temporaire(s) supprimé(s).`
				: "Aucun salon temporaire ouvert.",
		});
	},
};

export = command;
