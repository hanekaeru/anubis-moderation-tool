import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	escapeMarkdown,
	type GuildMember,
} from "discord.js";
import { DEFAULT_VOICE_TEAM_EMOJIS } from "@anubis/shared";
import * as colors from "../utils/constantes";

/**
 * Annonces de recherche de groupe (`/lfg`).
 *
 * Rien n'est stocke : l'annonce est un message, et c'est son embed qui porte
 * l'etat. La fermer, c'est la corriger. Un redemarrage du bot ne perd donc
 * rien — le bouton « Groupe complet » porte l'auteur dans son identifiant.
 */

export const LFG_CLOSE_PREFIX = "lfg:fermer:";

export interface Recherche {
	tank: number;
	dps: number;
	support: number;
	mode: string | null;
	rang: string | null;
	plateforme: string | null;
	note: string | null;
}

/**
 * « 🛡️ 1 · ⚔️ 2 » : seuls les roles cherches apparaissent, avec les memes
 * emojis que le sujet des salons vocaux temporaires. `null` si on ne cherche
 * personne — l'annonce n'aurait pas de raison d'etre.
 */
export function placesCherchees(recherche: Pick<Recherche, "tank" | "dps" | "support">): string | null {
	const roles = [
		["tank", recherche.tank],
		["dps", recherche.dps],
		["support", recherche.support],
	] as const;
	const parties = roles
		.filter(([, nombre]) => nombre > 0)
		.map(([role, nombre]) => `${DEFAULT_VOICE_TEAM_EMOJIS[role]} ${nombre}`);
	return parties.length ? parties.join(" · ") : null;
}

export function construireAnnonce(
	auteur: GuildMember,
	recherche: Recherche,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
	const places = placesCherchees(recherche) ?? "";
	const vocal = auteur.voice.channel;

	const embed = new EmbedBuilder()
		.setColor(colors.info)
		.setAuthor({ name: `${auteur.displayName} cherche des joueurs`, iconURL: auteur.displayAvatarURL() })
		.setTitle(places)
		.setTimestamp();

	const details = [
		recherche.mode ? `**Mode** : ${escapeMarkdown(recherche.mode)}` : null,
		recherche.rang ? `**Rang** : ${escapeMarkdown(recherche.rang)}` : null,
		recherche.plateforme ? `**Plateforme** : ${escapeMarkdown(recherche.plateforme)}` : null,
		vocal ? `**Vocal** : ${vocal}` : null,
	].filter(Boolean);
	if (details.length) embed.setDescription(details.join("\n"));
	if (recherche.note) embed.addFields({ name: "Note", value: recherche.note.slice(0, 1024) });

	const boutons = new ActionRowBuilder<ButtonBuilder>();
	// Le lien vers le vocal n'existe que si l'auteur y est deja : c'est la que
	// le groupe se forme, et ce que les autres veulent rejoindre.
	if (vocal) {
		boutons.addComponents(
			new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(vocal.url).setLabel("Rejoindre le vocal"),
		);
	}
	boutons.addComponents(
		new ButtonBuilder()
			.setCustomId(`${LFG_CLOSE_PREFIX}${auteur.id}`)
			.setStyle(ButtonStyle.Secondary)
			.setLabel("Groupe complet"),
	);

	return { embeds: [embed], components: [boutons] };
}

/** L'annonce close garde son contenu, grisee et sans boutons. */
export function annonceFermee(embed: EmbedBuilder): EmbedBuilder {
	const titre = embed.data.title ?? "";
	return embed.setColor(0x6c757d).setTitle(`~~${titre}~~ · groupe complet`);
}
