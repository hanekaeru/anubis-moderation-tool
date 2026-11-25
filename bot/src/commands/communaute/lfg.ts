import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types";
import { construireAnnonce, placesCherchees } from "../../collectors/lfg";

const MODES = ["Compétitif", "Partie rapide", "Arcade", "Partie personnalisée", "Stadium"];
const PLATEFORMES = ["PC", "PlayStation", "Xbox", "Switch", "Crossplay"];

/**
 * Recherche de groupe : une annonce dans le salon courant, avec un lien vers
 * le vocal de l'auteur s'il y est deja.
 *
 * Ouverte a tous ; les salons ou elle est permise se reglent dans les
 * parametres d'integration du serveur, sans code. Le delai d'une minute evite
 * qu'une meme personne inonde un salon d'annonces.
 */
const command: Command = {
	cooldown: 60,
	data: new SlashCommandBuilder()
		.setName("lfg")
		.setDescription("Chercher des joueurs pour une partie.")
		.addIntegerOption((o) => o.setName("tank").setDescription("Tanks recherchés.").setMinValue(0).setMaxValue(4))
		.addIntegerOption((o) => o.setName("dps").setDescription("DPS recherchés.").setMinValue(0).setMaxValue(4))
		.addIntegerOption((o) =>
			o.setName("support").setDescription("Supports recherchés.").setMinValue(0).setMaxValue(4),
		)
		.addStringOption((o) =>
			o
				.setName("mode")
				.setDescription("Mode de jeu.")
				.addChoices(...MODES.map((mode) => ({ name: mode, value: mode }))),
		)
		.addStringOption((o) => o.setName("rang").setDescription("Rang visé (Or, Platine…).").setMaxLength(40))
		.addStringOption((o) =>
			o
				.setName("plateforme")
				.setDescription("Plateforme.")
				.addChoices(...PLATEFORMES.map((p) => ({ name: p, value: p }))),
		)
		.addStringOption((o) => o.setName("note").setDescription("Précision libre.").setMaxLength(300)),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const recherche = {
			tank: interaction.options.getInteger("tank") ?? 0,
			dps: interaction.options.getInteger("dps") ?? 0,
			support: interaction.options.getInteger("support") ?? 0,
			mode: interaction.options.getString("mode"),
			rang: interaction.options.getString("rang")?.trim() || null,
			plateforme: interaction.options.getString("plateforme"),
			note: interaction.options.getString("note")?.trim() || null,
		};

		if (!placesCherchees(recherche)) {
			await interaction.reply({
				content: "Indique au moins un rôle recherché (tank, dps ou support).",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.reply({
			...construireAnnonce(interaction.member, recherche),
			// Le texte libre ne doit faire sonner personne.
			allowedMentions: { parse: [] },
		});
	},
};

export = command;
