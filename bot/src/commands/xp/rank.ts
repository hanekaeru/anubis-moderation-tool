import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types";
import xpManager from "../../collectors/xp";
import { rankEmbed } from "../../utils/xpEmbeds";

/**
 * Fiche de progression d'un membre.
 *
 * La commande accepte une cible : consulter le niveau de quelqu'un d'autre est
 * la moitie de l'usage d'un systeme d'XP, et l'obliger a taper `/rank` soi-meme
 * pour se comparer n'avait pas de raison d'etre.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("rank")
		.setDescription("Affiche ton niveau, ton XP et ton rang sur le serveur.")
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Membre à consulter (toi-même par défaut)."),
		),

	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const cible = interaction.options.getUser("membre") ?? interaction.user;

		if (cible.bot) {
			await interaction.reply({
				content: "Les bots ne gagnent pas d'XP.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Trois lectures en base : deferer evite de courir apres les trois
		// secondes de l'interaction sur un serveur charge.
		await interaction.deferReply();

		const [progress, rank, total] = await Promise.all([
			xpManager.getProgress(cible.id, interaction.guildId),
			xpManager.getRank(cible.id, interaction.guildId),
			xpManager.countRanked(interaction.guildId),
		]);

		await interaction.editReply({
			embeds: [rankEmbed(cible, progress, rank, Math.max(total, rank))],
		});
	},
};

export = command;
