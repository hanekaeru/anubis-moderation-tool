import { EsportMatchFormat } from "../enums";
import { addDaysToKey, zonedDateKey } from "../timezone";
import { IsoDateString, Snowflake } from "./common";

/**
 * Recapitulatifs esport.
 *
 * Le staff compose la semaine dans le dashboard, l'envoie, puis la corrige au
 * fil des jours ; le bot publie et met a jour. Chaque match termine produit en
 * plus un **message de resultat**, distinct du recapitulatif.
 *
 * Les deux embeds sont rendus ici, et nulle part ailleurs : le bot les envoie,
 * le dashboard les previsualise, l'API mesure leur taille avant d'accepter un
 * match de plus. Trois rendus separes finiraient par diverger.
 */

/** Fuseau de saisie et de regroupement par jour. */
export const ESPORT_TIME_ZONE = "Europe/Paris";

/** Au-dela, le recapitulatif deborderait des 6000 caracteres d'un embed. */
export const MAX_ESPORT_MATCHES_PER_WEEK = 40;

export const DEFAULT_ESPORT_TITLE = "🎮 Matchs esport de la semaine";
export const DEFAULT_ESPORT_COLOR = 0x5865f2;

/** Plus que de quoi ecrire un score de carte ou de manche. */
export const MAX_ESPORT_SCORE = 99;

/**
 * Mention de la source, ajoutee au pied des embeds des qu'un match affiche
 * vient de PandaScore — c'est la condition de reutilisation de leurs donnees.
 */
export const PANDASCORE_SOURCE_LABEL = "Source : PandaScore";

/**
 * Delai minimal entre deux appels a PandaScore pour une meme semaine.
 *
 * Le cache rend l'ouverture de l'import gratuite ; ce delai empeche seulement
 * qu'une serie de clics sur « Actualiser » vide le quota horaire.
 */
export const PANDASCORE_REFRESH_COOLDOWN_MS = 2 * 60_000;

export const ESPORT_MATCH_FORMAT_LABELS: Record<EsportMatchFormat, string> = {
	BEST_OF: "Au meilleur des (BO)",
	FIRST_TO: "Premier à (FT)",
};

/** « BO3 », « FT3 » ; `null` quand le nombre de manches n'est pas precise. */
export function esportFormatLabel(
	format: EsportMatchFormat | null | undefined,
	games: number | null | undefined,
): string | null {
	if (!games) return null;
	return `${format === "FIRST_TO" ? "FT" : "BO"}${games}`;
}

/** Statuts d'un match chez PandaScore, tels que le dashboard les affiche. */
export const PANDASCORE_STATUS_LABELS: Record<string, string> = {
	not_started: "À venir",
	running: "En cours",
	finished: "Terminé",
	canceled: "Annulé",
	postponed: "Reporté",
};

/**
 * Etat d'un message sur Discord, tel que le dashboard l'affiche.
 * - `DRAFT` : jamais envoye.
 * - `PENDING` : envoye ou modifie, en attente du bot.
 * - `PUBLISHED` : a jour sur Discord.
 * - `FAILED` : Discord a refuse, `lastError` dit pourquoi.
 * - `REMOVING` : retrait demande par un administrateur.
 */
export type EsportPublicationStatus =
	| "DRAFT"
	| "PENDING"
	| "PUBLISHED"
	| "FAILED"
	| "REMOVING";

export const ESPORT_PUBLICATION_STATUS_LABELS: Record<EsportPublicationStatus, string> = {
	DRAFT: "Brouillon",
	PENDING: "En attente du bot",
	PUBLISHED: "Publié",
	FAILED: "Échec",
	REMOVING: "Retrait en cours",
};

export interface EsportTeamDto {
	id: string;
	name: string;
	emoji: string | null;
	logoUrl: string | null;
	highlighted: boolean;
	archived: boolean;
	/** Equipe PandaScore reliee ; `null` pour une equipe saisie a la main. */
	pandascoreId: number | null;
}

export interface EsportTeamPayload {
	name: string;
	emoji?: string | null;
	logoUrl?: string | null;
	highlighted?: boolean;
}

export interface EsportConfigDto {
	channelId: Snowflake | null;
	resultsChannelId: Snowflake | null;
	mentionRoleId: Snowflake | null;
	mentionOnPublish: boolean;
	mentionOnResult: boolean;
	spoilerScores: boolean;
	color: number;
	title: string;
	pandascore: {
		/** Jeton present dans l'environnement de l'API. */
		available: boolean;
		leagueIds: number[];
		/** Mots-cles des series suivies ; vide pour toutes. */
		series: string[];
	};
	updatedAt: IsoDateString | null;
}

export type UpdateEsportConfigRequest = Partial<
	Omit<EsportConfigDto, "updatedAt" | "pandascore"> & {
		pandascoreLeagueIds: number[];
		pandascoreSeries: string[];
	}
>;

export interface EsportMatchDto {
	id: string;
	weekId: string;
	teamA: EsportTeamDto | null;
	teamB: EsportTeamDto | null;
	competition: string | null;
	scheduledAt: IsoDateString;
	format: EsportMatchFormat;
	bestOf: number | null;
	streamUrl: string | null;
	/** Match PandaScore d'origine ; `null` pour un match saisi a la main. */
	pandascoreId: number | null;
	finished: boolean;
	scoreA: number | null;
	scoreB: number | null;
	/** Exception au reglage du serveur ; `null` pour le suivre. */
	spoiler: boolean | null;
	/** Message de resultat ; `null` tant que le match n'est pas termine. */
	result: {
		status: EsportPublicationStatus;
		messageId: Snowflake | null;
		error: string | null;
	} | null;
}

export interface EsportMatchPayload {
	teamAId: string | null;
	teamBId: string | null;
	competition?: string | null;
	scheduledAt: IsoDateString;
	format?: EsportMatchFormat;
	bestOf?: number | null;
	streamUrl?: string | null;
}

export interface EsportResultRequest {
	scoreA: number;
	scoreB: number;
	/** `null` pour suivre le reglage du serveur. */
	spoiler: boolean | null;
}

export interface EsportWeekDto {
	id: string;
	/** Lundi de la semaine, `AAAA-MM-JJ`, heure de Paris. */
	weekStart: string;
	title: string | null;
	description: string | null;
	status: EsportPublicationStatus;
	messageId: Snowflake | null;
	lastError: string | null;
	publishedAt: IsoDateString | null;
	matches: EsportMatchDto[];
	updatedAt: IsoDateString;
}

export interface EsportWeekSummaryDto {
	id: string;
	weekStart: string;
	status: EsportPublicationStatus;
	matchCount: number;
	finishedCount: number;
}

export interface UpdateEsportWeekRequest {
	title?: string | null;
	description?: string | null;
}

// ---------------------------------------------------------------------------
// Import PandaScore
// ---------------------------------------------------------------------------

export interface PandascoreTeamDto {
	id: number;
	name: string;
	acronym: string | null;
	/** Logo pour fond sombre quand PandaScore en fournit un, clair sinon. */
	logoUrl: string | null;
}

/**
 * Match lu dans le cache PandaScore, mis en regard de la semaine composee.
 * Rien ici n'est modifiable : c'est la donnee de PandaScore telle que recue.
 */
export interface PandascoreMatchDto {
	id: number;
	scheduledAt: IsoDateString;
	/** Horaire deplace par l'organisateur depuis l'annonce initiale. */
	rescheduled: boolean;
	/** Cle de `PANDASCORE_STATUS_LABELS`. */
	status: string;
	/** Intitule que portera le match importe (« OWCS EMEA Stage 3 »). */
	competition: string;
	serie: string | null;
	tournament: string | null;
	format: EsportMatchFormat;
	games: number | null;
	teamA: PandascoreTeamDto | null;
	teamB: PandascoreTeamDto | null;
	/** Manches gagnees ; seulement une fois le match termine chez PandaScore. */
	score: { a: number; b: number } | null;
	forfeit: boolean;
	streamUrl: string | null;
	/** Fait partie des series suivies dans les reglages. */
	followed: boolean;
	/** Match de la semaine deja importe depuis celui-ci. */
	importedMatchId: string | null;
	/**
	 * Ce qui differe entre PandaScore et le match importe : une modification du
	 * staff, ou un changement chez PandaScore depuis l'import.
	 */
	differences: string[];
}

export interface PandascoreWeekDto {
	/** Jeton PandaScore configure sur l'API. */
	available: boolean;
	fetchedAt: IsoDateString | null;
	/** Avant cette date, une actualisation serait refusee. */
	refreshableAt: IsoDateString | null;
	matches: PandascoreMatchDto[];
	/** Matchs importes que PandaScore ne place plus dans cette semaine. */
	missing: { matchId: string; label: string }[];
}

export interface EsportImportRequest {
	/** Identifiants PandaScore. Un match deja importe est mis a jour. */
	ids: number[];
}

/** Score propose a la fin d'un match importe, dans l'ordre des equipes locales. */
export interface PandascoreResultSuggestionDto {
	available: boolean;
	fetchedAt: IsoDateString | null;
	refreshableAt: IsoDateString | null;
	/** `null` : le match n'est plus dans le cache de sa semaine. */
	status: string | null;
	score: { a: number; b: number } | null;
	forfeit: boolean;
}

// ---------------------------------------------------------------------------
// Rendu des embeds
// ---------------------------------------------------------------------------

export interface EsportEmbedTeam {
	name: string;
	emoji: string | null;
	logoUrl: string | null;
	highlighted: boolean;
}

export interface EsportEmbedMatch {
	teamA: EsportEmbedTeam | null;
	teamB: EsportEmbedTeam | null;
	competition: string | null;
	scheduledAt: Date | string;
	format: EsportMatchFormat;
	bestOf: number | null;
	streamUrl: string | null;
	/** Renseigne : le match vient de PandaScore, et la source est citee. */
	pandascoreId: number | null;
	finished: boolean;
	scoreA: number | null;
	scoreB: number | null;
	spoiler: boolean | null;
}

export interface EsportEmbedSettings {
	title: string;
	color: number;
	spoilerScores: boolean;
}

/** Forme acceptee telle quelle par discord.js (`APIEmbed`). */
export interface EsportEmbed {
	title: string;
	description?: string;
	color: number;
	fields: { name: string; value: string; inline: boolean }[];
	footer?: { text: string };
	thumbnail?: { url: string };
}

const FIELD_VALUE_LIMIT = 1024;

/** Les noms viennent du staff : un `_` ou un `|` ne doit rien mettre en forme. */
function escapeMarkdown(text: string): string {
	return text.replace(/([*_~|`\\])/g, "\\$1");
}

const dayFormat = new Intl.DateTimeFormat("fr-FR", {
	weekday: "long",
	day: "numeric",
	month: "long",
	timeZone: "UTC",
});

/** « Lundi 13 octobre », depuis une cle `AAAA-MM-JJ` (donc sans fuseau). */
export function esportDayLabel(key: string): string {
	const label = dayFormat.format(new Date(`${key}T12:00:00Z`));
	return label.charAt(0).toUpperCase() + label.slice(1);
}

function teamLabel(team: EsportEmbedTeam | null): string {
	if (!team) return "*À déterminer*";
	const name = escapeMarkdown(team.name);
	const shown = team.highlighted ? `**${name}**` : name;
	return team.emoji ? `${team.emoji} ${shown}` : shown;
}

/** Score affiche ; le spoiler du match l'emporte sur celui du serveur. */
export function esportScoreSpoiler(
	match: Pick<EsportEmbedMatch, "spoiler">,
	settings: Pick<EsportEmbedSettings, "spoilerScores">,
): boolean {
	return match.spoiler ?? settings.spoilerScores;
}

function scoreText(match: EsportEmbedMatch, spoiler: boolean): string {
	const score = `**${match.scoreA ?? 0} - ${match.scoreB ?? 0}**`;
	return spoiler ? `||${score}||` : score;
}

function unix(date: Date | string): number {
	return Math.floor(new Date(date).getTime() / 1000);
}

function matchLine(match: EsportEmbedMatch, settings: EsportEmbedSettings): string {
	const details: string[] = [];
	if (match.competition) details.push(`*${escapeMarkdown(match.competition)}*`);
	const format = esportFormatLabel(match.format, match.bestOf);
	if (format) details.push(format);

	if (match.finished) {
		const spoiler = esportScoreSpoiler(match, settings);
		const line = `✅ ${teamLabel(match.teamA)} ${scoreText(match, spoiler)} ${teamLabel(match.teamB)}`;
		return [line, ...details].join(" · ");
	}

	// Horodatage Discord : chaque membre lit l'heure dans son propre fuseau.
	const line = `<t:${unix(match.scheduledAt)}:t> ${teamLabel(match.teamA)} vs ${teamLabel(match.teamB)}`;
	if (match.streamUrl) details.push(`[Stream](${match.streamUrl})`);
	return [line, ...details].join(" · ");
}

/**
 * Recapitulatif de la semaine : un champ par jour, les matchs dans l'ordre.
 *
 * Les jours se forment a l'heure de Paris. Un jour trop charge pour un seul
 * champ (1024 caracteres) se poursuit dans un champ « (suite) » plutot que de
 * faire refuser l'embed entier.
 */
export function buildEsportWeekEmbed(
	week: {
		weekStart: string;
		title: string | null;
		description: string | null;
		matches: readonly EsportEmbedMatch[];
	},
	settings: EsportEmbedSettings,
): EsportEmbed {
	const range = `📅 Du ${esportDayLabel(week.weekStart).toLowerCase()} au ${esportDayLabel(
		addDaysToKey(week.weekStart, 6),
	).toLowerCase()}`;

	const description = [week.description?.trim(), range]
		.filter((part): part is string => !!part)
		.concat(week.matches.length ? [] : ["Aucun match prévu cette semaine."])
		.join("\n\n");

	const parJour = new Map<string, string[]>();
	const tries = [...week.matches].sort(
		(a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
	);
	for (const match of tries) {
		const jour = zonedDateKey(new Date(match.scheduledAt), ESPORT_TIME_ZONE);
		const lignes = parJour.get(jour) ?? [];
		lignes.push(matchLine(match, settings));
		parJour.set(jour, lignes);
	}

	const fields: EsportEmbed["fields"] = [];
	for (const [jour, lignes] of parJour) {
		let valeur = "";
		let suite = false;
		for (const ligne of lignes) {
			const candidate = valeur ? `${valeur}\n${ligne}` : ligne;
			if (candidate.length > FIELD_VALUE_LIMIT && valeur) {
				fields.push({
					name: esportDayLabel(jour) + (suite ? " (suite)" : ""),
					value: valeur,
					inline: false,
				});
				valeur = ligne;
				suite = true;
			} else {
				valeur = candidate;
			}
		}
		if (valeur) {
			fields.push({
				name: esportDayLabel(jour) + (suite ? " (suite)" : ""),
				value: valeur.slice(0, FIELD_VALUE_LIMIT),
				inline: false,
			});
		}
	}

	const pied = ["Horaires affichés dans votre fuseau horaire"];
	if (week.matches.some((match) => match.pandascoreId !== null)) pied.push(PANDASCORE_SOURCE_LABEL);

	return {
		title: week.title?.trim() || settings.title,
		description,
		color: settings.color,
		fields,
		footer: { text: pied.join(" · ") },
	};
}

/**
 * Annonce de resultat, volontairement differente du recapitulatif : elle
 * porte un seul match, en grand, et nomme le vainqueur.
 *
 * Sous spoiler, le vainqueur l'est aussi et le logo du gagnant n'est pas
 * affiche : il trahirait le resultat avant meme qu'on clique.
 */
export function buildEsportResultEmbed(
	match: EsportEmbedMatch,
	settings: EsportEmbedSettings,
): EsportEmbed {
	const spoiler = esportScoreSpoiler(match, settings);
	const a = match.scoreA ?? 0;
	const b = match.scoreB ?? 0;
	const gagnant = a === b ? null : a > b ? match.teamA : match.teamB;

	const nomGagnant = gagnant ? escapeMarkdown(gagnant.name) : "À déterminer";
	const verdict =
		a === b
			? spoiler
				? "🤝 ||Match nul||"
				: "🤝 Match nul"
			: spoiler
				? `🏆 Vainqueur : ||**${nomGagnant}**||`
				: `🏆 Victoire de **${nomGagnant}**`;

	const jour = esportDayLabel(zonedDateKey(new Date(match.scheduledAt), ESPORT_TIME_ZONE));
	const pied = [
		jour,
		esportFormatLabel(match.format, match.bestOf),
		match.pandascoreId !== null ? PANDASCORE_SOURCE_LABEL : null,
	]
		.filter((part): part is string => !!part)
		.join(" · ");

	return {
		title: match.competition
			? `🏁 Résultat — ${match.competition}`
			: "🏁 Résultat du match",
		description: `${teamLabel(match.teamA)} ${scoreText(match, spoiler)} ${teamLabel(match.teamB)}\n\n${verdict}`,
		color: settings.color,
		fields: [],
		footer: { text: pied },
		...(!spoiler && gagnant?.logoUrl ? { thumbnail: { url: gagnant.logoUrl } } : {}),
	};
}

/** Total de caracteres compte par Discord pour la limite de 6000. */
export function esportEmbedSize(embed: EsportEmbed): number {
	return (
		embed.title.length +
		(embed.description?.length ?? 0) +
		(embed.footer?.text.length ?? 0) +
		embed.fields.reduce((total, field) => total + field.name.length + field.value.length, 0)
	);
}
