import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types";
import * as voiceHubs from "../../collectors/voiceHubs";

/**
 * Cree les salons vocaux « de creation » decrits dans le dashboard.
 *
 * La liste elle-meme se gere sur la webapp (page Vocaux) : cette commande ne
 * fait que la materialiser sur Discord, sur le meme principe que
 * `/create_logs`. Elle est rejouable — un salon deja cree est laisse tel quel.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("create_parties")
		.setDescription(
			"ADMIN - Crée les salons vocaux de création configurés dans le dashboard.",
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

		const manquantes = voiceHubs.permissionsManquantes(interaction.guild);
		if (manquantes.length) {
			await interaction.reply({
				content: `Il me manque ces permissions : ${manquantes.join(", ")}.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const lignes = await voiceHubs.creerSalonsDeCreation(interaction.guild);

		if (!lignes.length) {
			await interaction.editReply({
				content:
					"Aucun salon de création actif n'est configuré. Ajoute-les depuis la page Vocaux du dashboard.",
			});
			return;
		}

		await interaction.editReply({
			content: `Salons de création prets :\n${lignes.join("\n")}`,
		});
	},
};

export = command;
