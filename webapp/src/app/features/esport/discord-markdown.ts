/**
 * Sous-ensemble du Markdown de Discord, pour l'apercu des embeds esport.
 *
 * Juste ce que produisent `buildEsportWeekEmbeds` et `buildEsportResultEmbed` :
 * gras, italique, spoiler, lien, horodatage, emoji du serveur, mention de role.
 * Le rendu se fait en segments affiches par le template — jamais par
 * `innerHTML`, puisque les noms d'equipe sont saisis librement.
 */

export type DiscordSegment =
	| { kind: 'text'; text: string }
	| { kind: 'bold' | 'italic' | 'spoiler'; children: DiscordSegment[] }
	| { kind: 'link'; text: string; url: string }
	| { kind: 'time'; text: string }
	| { kind: 'emoji'; url: string; name: string }
	| { kind: 'mention'; text: string };

const PATTERN =
	/<(a?):(\w+):(\d+)>|<t:(\d+)(?::([tTdDfFR]))?>|\|\|(.+?)\|\||\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|<@&\d+>/g;

const timeFormats: Record<string, Intl.DateTimeFormatOptions> = {
	t: { hour: '2-digit', minute: '2-digit' },
	T: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
	d: { day: '2-digit', month: '2-digit', year: 'numeric' },
	D: { day: 'numeric', month: 'long', year: 'numeric' },
	f: { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' },
	F: {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	},
};

/** Les noms sont echappes par le rendu partage : on retire l'echappement. */
function texte(value: string): DiscordSegment[] {
	return value ? [{ kind: 'text', text: value.replace(/\\([*_~|`\\])/g, '$1') }] : [];
}

/**
 * Comme Discord, l'heure est affichee dans le fuseau de celui qui regarde :
 * l'apercu montre donc l'heure du navigateur.
 */
function heure(seconds: string, style = 'f'): string {
	const date = new Date(Number(seconds) * 1000);
	return new Intl.DateTimeFormat('fr-FR', timeFormats[style] ?? timeFormats['f']).format(date);
}

export function parseDiscordMarkdown(source: string, roleLabel = '@Esport'): DiscordSegment[] {
	const segments: DiscordSegment[] = [];
	let dernier = 0;

	for (const match of source.matchAll(PATTERN)) {
		segments.push(...texte(source.slice(dernier, match.index)));
		dernier = match.index + match[0].length;

		const [, anime, nom, emojiId, ts, style, spoiler, gras, italique, lien, url] = match;

		if (emojiId) {
			segments.push({
				kind: 'emoji',
				name: nom!,
				url: `https://cdn.discordapp.com/emojis/${emojiId}.${anime ? 'gif' : 'png'}?size=48`,
			});
		} else if (ts) {
			segments.push({ kind: 'time', text: heure(ts, style) });
		} else if (spoiler !== undefined) {
			segments.push({ kind: 'spoiler', children: parseDiscordMarkdown(spoiler, roleLabel) });
		} else if (gras !== undefined) {
			segments.push({ kind: 'bold', children: parseDiscordMarkdown(gras, roleLabel) });
		} else if (italique !== undefined) {
			segments.push({ kind: 'italic', children: parseDiscordMarkdown(italique, roleLabel) });
		} else if (lien !== undefined) {
			segments.push({ kind: 'link', text: lien, url: url! });
		} else {
			segments.push({ kind: 'mention', text: roleLabel });
		}
	}

	segments.push(...texte(source.slice(dernier)));
	return segments;
}

/** Adresse d'image d'un emoji du serveur (`<:nom:id>`), `null` pour un unicode. */
export function customEmojiUrl(emoji: string | null): string | null {
	const match = emoji?.match(/^<(a?):\w+:(\d+)>$/);
	return match ? `https://cdn.discordapp.com/emojis/${match[2]}.${match[1] ? 'gif' : 'png'}?size=48` : null;
}
