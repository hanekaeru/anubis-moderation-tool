import {
	ChannelType,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import * as owdle from "../../collectors/owdle";
import type { Command } from "../../types";
import { baseCommandEmbed, repondreSucces } from "../../utils/commandEmbed";

/**
 * Salon des annonces de victoire de l'OWdle.
 *
 * Commande a part plutot que sous-commande de `/owdle` : Discord ne regle les
 * permissions qu'a l'echelle d'une commande entiere, et ce reglage ne doit pas
 * etre propose a tous les joueurs.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("owdle_salon")
		.setDescription("Choisit le salon où sont annoncées les victoires à l'OWdle.")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addChannelOption((option) =>
			option
				.setName("salon")
				.setDescription("Salon des annonces. Vide : le salon où la partie a été gagnée.")
				.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
		),

	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const salon = interaction.options.getChannel("salon");
		await owdle.definirSalonAnnonce(interaction.guildId, salon?.id ?? null);

		await repondreSucces(
			interaction,
			baseCommandEmbed("owdle_salon"),
			salon
				? `Les victoires à l'OWdle seront annoncées dans ${salon}.`
				: "Les victoires à l'OWdle seront annoncées dans le salon où la partie a été gagnée.",
		);
	},
};

export = command;
