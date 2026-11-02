import type { User } from "discord.js";
import { EmbedBuilder } from "discord.js";
import * as colors from "./constantes";

/**
 * Nature du message prive : elle decide du titre, de la couleur et du recours
 * propose. Une levee annoncee en rouge sous « Nouvelle sanction » se lisait
 * comme une sanction de plus.
 */
export type MemberNotice = "SANCTION" | "LEVEE" | "AVERTISSEMENT";

const PRESENTATION: Record<
	MemberNotice,
	{ titre: string; couleur: `#${string}`; recours: string | null }
> = {
	// Une personne bannie ou expulsee n'a plus acces aux tickets, et un membre
	// exclu temporairement ne peut plus cliquer sur le panneau : le seul recours
	// valable pour tous est de s'adresser a l'equipe.
	SANCTION: {
		titre: "🚫 Nouvelle sanction",
		couleur: colors.danger,
		recours:
			"Si tu penses qu'il s'agit d'une erreur, contacte un membre de l'équipe de modération.",
	},
	LEVEE: { titre: "✅ Sanction levée", couleur: colors.success, recours: null },
	AVERTISSEMENT: {
		titre: "⚠️ Nouvel avertissement",
		couleur: colors.warning,
		recours: "Une question ou un désaccord ? Ouvre un ticket sur le serveur.",
	},
};

/** Embed d'un message prive de moderation, partage avec `warningNotice`. */
export function memberNoticeEmbed(kind: MemberNotice, message: string): EmbedBuilder {
	const { titre, couleur, recours } = PRESENTATION[kind];
	const embed = new EmbedBuilder()
		.setColor(couleur)
		.setTitle(titre)
		.setDescription(message)
		.setTimestamp();
	if (recours) embed.setFooter({ text: recours });
	return embed;
}

/**
 * DM best-effort. Un membre qui a ferme ses messages prives ne doit jamais
 * faire echouer l'action de moderation elle-meme.
 */
export async function notifyMember(
	user: User,
	message: string,
	kind: MemberNotice = "SANCTION",
): Promise<void> {
	try {
		await user.send({ embeds: [memberNoticeEmbed(kind, message)] });
	} catch {
		// DMs fermes, bot bloque, ou compte supprime : sans consequence ici.
	}
}
