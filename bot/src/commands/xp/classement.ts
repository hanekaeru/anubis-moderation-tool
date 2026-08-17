import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types";
import { renderLeaderboard } from "../../handlers/leaderboardInteractions";

/** Classement du serveur par XP, page par page. */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("classement")
		.setDescription("Affiche le classement des membres par XP.")
		.addIntegerOption((option) =>
			option
				.setName("page")
				.setDescription("Page du classement à afficher.")
				.setMinValue(1),
		),
	cooldown: 5,

	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		await renderLeaderboard(interaction, interaction.options.getInteger("page") ?? 1);
	},
};

export = command;
