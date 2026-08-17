import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types";
import * as voiceHubs from "../../collectors/voiceHubs";

/**
 * Supprime les salons vocaux de creation sans toucher a leur configuration.
 *
 * C'est ce qui rend une mise a jour rapide : on efface, on retouche la liste
 * depuis le dashboard, on relance `/create_parties`. Les salons temporaires
 * deja ouverts ne sont pas concernes — ils vivent leur vie et disparaitront
 * d'eux-memes une fois vides (voir `/purge_vocaux` pour les forcer).
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("delete_parties")
		.setDescription(
			"ADMIN - Supprime les salons vocaux de création (la configuration est conservée).",
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

		const supprimes = await voiceHubs.supprimerSalonsDeCreation(interaction.guild);

		await interaction.editReply({
			content: supprimes
				? `${supprimes} salon(s) de création supprimé(s). La configuration est conservée : relance \`/create_parties\` pour les recréer.`
				: "Aucun salon de création à supprimer.",
		});
	},
};

export = command;
