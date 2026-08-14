import { EmbedBuilder } from "discord.js";
import * as colors from "../../utils/constantes";

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
