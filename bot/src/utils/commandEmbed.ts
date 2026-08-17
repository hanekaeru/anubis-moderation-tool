import {
	type ChatInputCommandInteraction,
	type ColorResolvable,
	EmbedBuilder,
	MessageFlags,
} from "discord.js";
import * as colors from "./constantes";

/**
 * Squelette d'embed commun a toutes les commandes de moderation, sur le
 * modele deja en place dans `/shadowban` et `/mute` : couleur `info` par
 * defaut, a rebasculer en `success`/`danger` selon l'issue.
 */
export function baseCommandEmbed(commandName: string): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(colors.info)
		.setTitle(`Anubis - /${commandName}`)
		.setTimestamp()
		.setFooter({
			text: "En cas de problème, vous pouvez ouvrir un ticket ou en parler aux administrateurs.",
		});
}

/**
 * Repond a la commande avec son embed, en message ephemere.
 *
 * Les commandes de moderation sont une suite de gardes qui se terminent
 * chacune par les quatre memes lignes (description, couleur, `reply`,
 * `return`). Les reunir ici laisse voir la logique de la commande plutot que
 * la mecanique de la reponse.
 */
async function repondre(
	interaction: ChatInputCommandInteraction,
	embed: EmbedBuilder,
	description: string,
	couleur: ColorResolvable,
): Promise<void> {
	embed.setDescription(description).setColor(couleur);
	await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/** Refus ou echec : l'action n'a pas eu lieu. */
export function repondreEchec(
	interaction: ChatInputCommandInteraction,
	embed: EmbedBuilder,
	description: string,
): Promise<void> {
	return repondre(interaction, embed, description, colors.danger);
}

/** L'action a bien eu lieu. */
export function repondreSucces(
	interaction: ChatInputCommandInteraction,
	embed: EmbedBuilder,
	description: string,
): Promise<void> {
	return repondre(interaction, embed, description, colors.success);
}
