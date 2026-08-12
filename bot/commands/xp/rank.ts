import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../src/types";
import xpManager from "../../src/collectors/xp";

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("rank")
		.setDescription("Get your current rank and XP on this server !"),
	async execute(interaction) {
		if (!interaction.inGuild()) return;

		const xp = await xpManager.getXp(
			interaction.user.id,
			interaction.guildId,
		);
		const restant = await xpManager.getXpBeforeNextLevel(xp);

		const embed = {
			color: 0x0099ff,
			title: `${interaction.user.username}'s Rank`,
			fields: [
				{
					name: "Current level",
					value: `Level ${await xpManager.getLevelFromXp(xp)}`,
					inline: true,
				},
				{
					name: "Next level in",
					// Au dernier palier il n'y a plus de niveau suivant :
					// afficher "0 xp." laisserait croire a un niveau imminent.
					value:
						restant > 0
							? `${restant} xp.`
							: "Niveau maximal atteint.",
					inline: true,
				},
				{ name: "Experience gained", value: `${xp} xp.`, inline: true },
			],
		};

		await interaction.reply({ embeds: [embed] });
	},
};

export = command;
