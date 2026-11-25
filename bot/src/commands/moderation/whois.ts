import {
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../../types";
import { ficheWhois } from "../../collectors/whois";

/**
 * Tout ce qu'on sait d'un compte : ce que Discord en dit, puis ce que la base
 * a retenu (noms passes, activite, moderation, quarantaine, Battle.net,
 * signalements).
 *
 * Fonctionne aussi pour quelqu'un qui a quitte le serveur : Discord resout
 * l'utilisateur meme hors du serveur, et la base garde la trace de son passage.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("whois")
		.setDescription("Tout ce que l'on sait d'un utilisateur, présent ou parti.")
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("L'utilisateur à consulter (mention ou identifiant).")
				.setRequired(true),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		// Revérifiee : la permission declaree n'est qu'un defaut, qu'un
		// administrateur peut elargir depuis les reglages d'integration du
		// serveur. La fiche expose sanctions et signalements.
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)) {
			await interaction.reply({
				content: "Tu n'as pas la permission de consulter cette fiche.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Toujours ephemere : la fiche contient la moderation et les
		// signalements du compte, rien qui ait a s'afficher dans un salon.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const cible = interaction.options.getUser("membre", true);

		await interaction.editReply({
			embeds: await ficheWhois(interaction.guild, cible),
			allowedMentions: { parse: [] },
		});
	},
};

export = command;
