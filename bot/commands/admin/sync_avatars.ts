import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../src/types";
import * as referentiel from "../../src/collectors/referentiel";

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("sync_avatars")
		.setDescription("ADMIN - Synchronise les images de profil dans l'application web.")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;
		if (interaction.replied || interaction.deferred) return;

		if (
			!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
		) {
			await interaction.reply({
				content: "Tu n'as pas la permission de synchroniser les images de profil.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		interaction.guild.members.fetch()
			.then(console.log)
			.catch(console.error);

		interaction.reply("Done!");
	},
};

export = command;
