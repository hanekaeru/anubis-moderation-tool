import { MessageFlags, SlashCommandBuilder } from "discord.js";
import * as battlenet from "../../collectors/battlenet";
import type { Command } from "../../types";

/**
 * Lier son compte Battle.net hors du parcours de quarantaine.
 *
 * Meme chemin que le bouton du message de reglement : quarantaine coupee,
 * quarantaine qui n'exige pas la verification, ou ancien membre arrive avant
 * qu'elle ne l'exige. Reponse ephemere plutot que message prive : beaucoup de
 * membres ferment leurs messages prives, et le lien n'arriverait jamais.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("lier_battlenet")
		.setDescription("Lie ton compte Battle.net à ton compte Discord sur ce serveur."),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const demande = await battlenet.demanderVerification(
			interaction.guildId,
			interaction.user,
		);

		await interaction.editReply(
			demande.kind === "lien"
				? battlenet.messageLien(demande.url)
				: { content: battlenet.messageRefus(demande) },
		);
	},
};

export = command;
