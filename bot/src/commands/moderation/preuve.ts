import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types";
import {
	buildEvidenceModal,
	fetchSanctionsChoisissables,
} from "../../handlers/evidenceInteractions";

/**
 * Depot de preuves sur une sanction existante.
 *
 * La commande n'ecrit rien : elle ouvre la modale, et c'est
 * `handleEvidenceModal` qui enregistre. Elle ne peut donc pas differer sa
 * reponse — `showModal` est refuse apres un `deferReply`, et la lecture des
 * sanctions doit tenir dans les trois secondes accordees a l'interaction.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("preuve")
		.setDescription("Joindre des preuves à une sanction d'un membre.")
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Le membre dont documenter une sanction.")
				.setRequired(true),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		// `setDefaultMemberPermissions` ne fixe que la visibilite par defaut : un
		// administrateur peut rouvrir la commande a tous depuis les reglages du
		// serveur. Le controle reel est ici, comme pour `/casier`.
		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
			await interaction.reply({
				content: "Tu n'as pas la permission de deposer des preuves.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const cible = interaction.options.getUser("membre", true);
		const sanctions = await fetchSanctionsChoisissables(
			interaction.guildId,
			cible.id,
		);

		if (!sanctions.length) {
			await interaction.reply({
				content: `Aucune sanction enregistrée pour ${cible.tag} : il n'y a rien a documenter.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.showModal(buildEvidenceModal(cible, sanctions));
	},
};

export = command;
