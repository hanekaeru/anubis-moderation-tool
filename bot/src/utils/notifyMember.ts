import type { User } from "discord.js";
import { EmbedBuilder } from "discord.js";
import * as colors from "../../utils/constantes";

/**
 * DM best-effort. Un membre qui a ferme ses messages prives ne doit jamais
 * faire echouer l'action de moderation elle-meme.
 */
export async function notifyMember(user: User, message: string): Promise<void> {
	const messageEmbed = new EmbedBuilder()
		.setColor(colors.danger)
		.setTitle("Anubis - Nouvelle sanction")
		.setTimestamp()
		.setFooter({
			text: "En cas de problème, vous pouvez ouvrir un ticket ou en parler aux administrateurs.",
		});
	try {
		messageEmbed.setDescription(message);
		await user.send({ embeds: [messageEmbed] });
	} catch {
		// DMs fermes, bot bloque, ou compte supprime : sans consequence ici.
	}
}
