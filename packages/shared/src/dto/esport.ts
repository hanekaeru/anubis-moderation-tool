import { EsportMatchFormat } from "../enums";
import { addDaysToKey, mondayOfKey, zonedDateKey, zonedTimeOfDay } from "../timezone";
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

/**
 * Heure de Paris a laquelle une journee esport commence.
 *
 * Les matchs nord-americains du dimanche se jouent a 1 h du matin lundi, heure
 * de Paris : ils font partie de la journee du dimanche, et donc de sa semaine.
 * Une journee va ainsi de 06:00 a 05:59 le lendemain, et une semaine du lundi
 * 06:00 au lundi suivant 05:59. Les matchs d'avant 06:00 portent un 🌙.
 */
export const ESPORT_DAY_START = "06:00";

/** Journee esport (`AAAA-MM-JJ`) d'un instant : la veille avant 06:00. */
export function esportDayKey(instant: Date): string {
	const jour = zonedDateKey(instant, ESPORT_TIME_ZONE);
	return isEsportNight(instant) ? addDaysToKey(jour, -1) : jour;
}

/** Lundi de la semaine esport qui contient cet instant. */
export function esportWeekStart(instant: Date): string {
	return mondayOfKey(esportDayKey(instant));
}

/** Match de nuit : rattache a la journee de la veille. */
export function isEsportNight(instant: Date): boolean {
	return zonedTimeOfDay(instant, ESPORT_TIME_ZONE) < ESPORT_DAY_START;
}

/** Calendrier reel d'une saisie « journee + heure » : avant 06:00, le lendemain. */
export function esportCalendarDay(dayKey: string, time: string): string {
	return time < ESPORT_DAY_START ? addDaysToKey(dayKey, 1) : dayKey;
}

/**
 * Regions des circuits, dans l'ordre ou le dashboard les propose. Les
 * mots-cles reconnaissent la region dans les intitules et les pages de
 * Liquipedia (« OWCS EMEA Stage 3 », « Overwatch_Champions_Series/2026/NA/… »)
 * a l'import. Ils se comparent **mot a mot** : « na » ne doit pas se lire dans
 * « Finals ».
 */
export const ESPORT_REGIONS = [
	{ code: "EMEA", label: "EMEA", emoji: "🇪🇺", color: 0x3b82f6, keywords: ["emea", "europe"] },
	{ code: "NA", label: "Amérique du Nord", emoji: "🇺🇸", color: 0xe5484d, keywords: ["north america", "americas", "na"] },
	{ code: "KR", label: "Corée", emoji: "🇰🇷", color: 0x8e4ec6, keywords: ["korea"] },
	{ code: "CN", label: "Chine", emoji: "🇨🇳", color: 0xf5a524, keywords: ["china"] },
	{ code: "JP", label: "Japon", emoji: "🇯🇵", color: 0xe93d82, keywords: ["japan"] },
	{ code: "PAC", label: "Pacifique", emoji: "🌏", color: 0x12a594, keywords: ["pacific", "asia", "oceania"] },
	{ code: "INTL", label: "International", emoji: "🌍", color: 0x30a46c, keywords: ["world", "midseason", "international", "finals", "clash", "ewc"] },
] as const;

/** Couleur de la bande d'une region : le reglage du serveur, sinon celle par defaut. */
export function esportRegionColor(
	code: string | null | undefined,
	settings: Pick<EsportEmbedSettings, "color" | "regionColors">,
): number {
	const region = esportRegion(code);
	if (!region) return settings.color;
	return settings.regionColors?.[region.code] ?? region.color;
}

/** Couleurs de toutes les regions, reglages du serveur appliques sur les defauts. */
export function resolveEsportRegionColors(
	overrides: Partial<Record<string, number>> | null | undefined,
): Record<EsportRegion, number> {
	return Object.fromEntries(
		ESPORT_REGIONS.map((region) => [region.code, overrides?.[region.code] ?? region.color]),
	) as Record<EsportRegion, number>;
}

export type EsportRegion = (typeof ESPORT_REGIONS)[number]["code"];
export const ESPORT_REGION_CODES = ESPORT_REGIONS.map((region) => region.code) as EsportRegion[];

export function esportRegion(code: string | null | undefined) {
	return ESPORT_REGIONS.find((region) => region.code === code) ?? null;
}

/** « 🇪🇺 EMEA » ; `null` sans region. */
export function esportRegionLabel(code: string | null | undefined): string | null {
	const region = esportRegion(code);
	return region ? `${region.emoji} ${region.label}` : null;
}

/**
 * Mot-cle cherche comme un mot entier : precede et suivi d'autre chose qu'une
 * lettre ou un chiffre. Les `_` et `/` des noms de page comptent donc comme des
 * separateurs. Le groupe 1 garde le caractere qui precede, pour un remplacement.
 */
function keywordPattern(motCle: string): RegExp {
	const echappe = motCle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s_]+");
	return new RegExp(`(^|[^\\p{L}\\p{N}])${echappe}(?=$|[^\\p{L}\\p{N}])`, "giu");
}

/** Region reconnue dans un intitule ; la premiere qui correspond l'emporte. */
export function detectEsportRegion(text: string): EsportRegion | null {
	return (
		ESPORT_REGIONS.find((region) =>
			region.keywords.some((motCle) => keywordPattern(motCle).test(text)),
		)?.code ?? null
	);
}

/** Au-dela, le recapitulatif deborderait des 6000 caracteres d'un embed. */
export const MAX_ESPORT_MATCHES_PER_WEEK = 40;

export const DEFAULT_ESPORT_TITLE = "🎮 Matchs esport de la semaine";
export const DEFAULT_ESPORT_COLOR = 0x5865f2;

/** Plus que de quoi ecrire un score de carte ou de manche. */
export const MAX_ESPORT_SCORE = 99;

/** Wiki Liquipedia interroge, et dont les pages sont citees. */
export const LIQUIPEDIA_WIKI = "overwatch";

/**
 * Mention de la licence, au pied des embeds des qu'un match affiche vient de
 * Liquipedia. Le lien vers la page du tournoi, lui, va dans la description :
 * Discord ne rend aucun lien dans un pied d'embed.
 */
export const LIQUIPEDIA_SOURCE_LABEL = "Données : Liquipedia (CC BY-SA 3.0)";

/**
 * Delai minimal entre deux appels a Liquipedia pour une meme semaine.
 *
 * Le cache rend l'ouverture de l'import gratuite ; ce delai empeche seulement
 * qu'une serie de clics sur « Actualiser » vide le quota de la cle.
 */
export const LIQUIPEDIA_REFRESH_COOLDOWN_MS = 2 * 60_000;

/** Adresse d'une page du wiki (`Overwatch_Champions_Series/2026/EMEA/Stage_3`). */
export function liquipediaPageUrl(page: string): string {
	const chemin = page
		.trim()
		.replace(/ /g, "_")
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return `https://liquipedia.net/${LIQUIPEDIA_WIKI}/${chemin}`;
}

/** Abreviations d'usage : un nom de page complet alourdirait chaque embed. */
const LIQUIPEDIA_SERIES_ABBREVIATIONS: Record<string, string> = {
	"Overwatch Champions Series": "OWCS",
};

/**
 * Libelle lisible d'une page : « OWCS 2026 EMEA Stage 3 » pour
 * `Overwatch_Champions_Series/2026/EMEA/Stage_3`.
 */
export function liquipediaPageLabel(page: string): string {
	const segments = page
		.split("/")
		.map((segment) => segment.replace(/_/g, " ").trim())
		.filter(Boolean);
	if (!segments.length) return page;
	segments[0] = LIQUIPEDIA_SERIES_ABBREVIATIONS[segments[0]!] ?? segments[0]!;
	return segments.join(" ");
}

/**
 * « 📚 Source : [Liquipedia · OWCS 2026 EMEA Stage 3](…) », un lien par page
 * distincte ; `null` si aucun match ne vient de Liquipedia.
 */
export function liquipediaSourceLine(pages: readonly (string | null | undefined)[]): string | null {
	const uniques = [...new Set(pages.filter((page): page is string => !!page?.trim()))];
	if (!uniques.length) return null;
	const liens = uniques.map(
		(page) => `[Liquipedia · ${escapeMarkdown(liquipediaPageLabel(page))}](${liquipediaPageUrl(page)})`,
	);
	return `📚 Source : ${liens.join(", ")}`;
}

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

/**
 * Statut d'un match Liquipedia, deduit de `finished`, `status` et de l'heure :
 * Liquipedia ne distingue pas « a venir » d'« en cours ».
 */
export type LiquipediaMatchStatus = "upcoming" | "live" | "finished" | "notplayed";

export const LIQUIPEDIA_STATUS_LABELS: Record<LiquipediaMatchStatus, string> = {
	upcoming: "À venir",
	live: "En cours",
	finished: "Terminé",
	notplayed: "Non joué",
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
	/** Equipe Liquipedia reliee (nom de sa page) ; `null` pour une equipe saisie a la main. */
	liquipediaName: string | null;
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
	/** Couleur des embeds sans region (et de l'annonce de resultat). */
	color: number;
	/** Couleur de l'embed de chaque region, defauts compris. */
	regionColors: Record<EsportRegion, number>;
	title: string;
	liquipedia: {
		/** Cle presente dans l'environnement de l'API. */
		available: boolean;
		/** Series interrogees (champ `series` des matchs Liquipedia). */
		series: string[];
		/** Mots-cles des competitions suivies ; vide pour toutes. */
		keywords: string[];
		/** Un BO impair de Liquipedia se lit en « premier a » (BO5 -> FT3). */
		firstTo: boolean;
	};
	updatedAt: IsoDateString | null;
}

export type UpdateEsportConfigRequest = Partial<
	Omit<EsportConfigDto, "updatedAt" | "liquipedia" | "regionColors"> & {
		liquipediaSeries: string[];
		liquipediaKeywords: string[];
		liquipediaFirstTo: boolean;
		/** Couleur par code de region ; une couleur egale au defaut n'est pas gardee. */
		regionColors: Partial<Record<string, number>>;
	}
>;

export interface EsportMatchDto {
	id: string;
	weekId: string;
	teamA: EsportTeamDto | null;
	teamB: EsportTeamDto | null;
	competition: string | null;
	/** Code de ESPORT_REGIONS : l'intertitre sous lequel le match se range. */
	region: string | null;
	scheduledAt: IsoDateString;
	format: EsportMatchFormat;
	bestOf: number | null;
	streamUrl: string | null;
	/** Match Liquipedia d'origine (`match2id`) ; `null` pour un match saisi a la main. */
	liquipediaId: string | null;
	/** Page Liquipedia du tournoi, citee sous les embeds. */
	liquipediaPage: string | null;
	finished: boolean;
	scoreA: number | null;
	scoreB: number | null;
	/** Exception au reglage du serveur ; `null` pour le suivre. */
	spoiler: boolean | null;
	/** Le resultat a son propre message, en plus du score dans le recapitulatif. */
	announceResult: boolean;
	/**
	 * Score releve sur Liquipedia, a valider par « Terminer » (ou « Corriger »
	 * s'il differe d'un score deja saisi). N'a encore rien change nulle part.
	 */
	suggestion: {
		scoreA: number;
		scoreB: number;
		forfeit: boolean;
		at: IsoDateString;
	} | null;
	/**
	 * Message de resultat ; `null` sans annonce demandee ni message publie.
	 */
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
	region?: string | null;
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
	/**
	 * Publier une annonce de resultat dans le salon des resultats. Sans elle,
	 * seul le recapitulatif montre le score. Une annonce deja publiee est
	 * corrigee quoi qu'il arrive : la decocher ne la retire pas.
	 */
	announce: boolean;
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
// Import Liquipedia
// ---------------------------------------------------------------------------

export interface LiquipediaTeamDto {
	/** Nom de l'adversaire chez Liquipedia (sa page) : la cle de rapprochement. */
	key: string;
	name: string;
	// Pas de logo : Liquipedia refuse ses images aux autres sites (403).
}

/**
 * Match lu dans le cache Liquipedia, mis en regard de la semaine composee.
 * Rien ici n'est modifiable : c'est la donnee de Liquipedia telle que recue.
 */
export interface LiquipediaMatchDto {
	/** `match2id`. */
	id: string;
	scheduledAt: IsoDateString;
	/** Horaire exact ; faux : Liquipedia n'a qu'une estimation. */
	dateExact: boolean;
	status: LiquipediaMatchStatus;
	/** Intitule que portera le match importe (« OWCS EMEA Stage 3 - Regular Season »). */
	competition: string;
	/** Region reconnue dans l'intitule ou la page du tournoi. */
	region: string | null;
	/** Nom complet du tournoi. */
	tournament: string | null;
	/** Page du tournoi (le Stage), citee comme source. */
	page: string | null;
	format: EsportMatchFormat;
	games: number | null;
	teamA: LiquipediaTeamDto | null;
	teamB: LiquipediaTeamDto | null;
	/** Manches gagnees ; seulement une fois le match termine chez Liquipedia. */
	score: { a: number; b: number } | null;
	forfeit: boolean;
	streamUrl: string | null;
	/** Fait partie des competitions suivies dans les reglages. */
	followed: boolean;
	/** Match de la semaine deja importe depuis celui-ci. */
	importedMatchId: string | null;
	/**
	 * Ce qui differe entre Liquipedia et le match importe : une modification du
	 * staff, ou un changement chez Liquipedia depuis l'import.
	 */
	differences: string[];
}

export interface LiquipediaWeekDto {
	/** Cle Liquipedia configuree sur l'API. */
	available: boolean;
	fetchedAt: IsoDateString | null;
	/** Avant cette date, une actualisation serait refusee. */
	refreshableAt: IsoDateString | null;
	matches: LiquipediaMatchDto[];
	/** Matchs importes que Liquipedia ne place plus dans cette semaine. */
	missing: { matchId: string; label: string }[];
}

export interface EsportImportRequest {
	/** Identifiants Liquipedia (`match2id`). Un match deja importe est mis a jour. */
	ids: string[];
}

/**
 * Resultat de « Recuperer les scores » : des propositions posees sur les
 * matchs, rien de plus. Ni score, ni recapitulatif, ni message ne bougent.
 */
export interface LiquipediaScoresDto {
	week: EsportWeekDto;
	fetchedAt: IsoDateString | null;
	/** Liquipedia a ete rappele ; faux : les donnees avaient moins de deux minutes. */
	refreshed: boolean;
	/** Matchs portant desormais une proposition. */
	suggested: number;
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
	region: string | null;
	scheduledAt: Date | string;
	format: EsportMatchFormat;
	bestOf: number | null;
	streamUrl: string | null;
	/** Renseigne : le match vient de Liquipedia, et cette page est citee. */
	liquipediaPage: string | null;
	finished: boolean;
	scoreA: number | null;
	scoreB: number | null;
	spoiler: boolean | null;
}

export interface EsportEmbedSettings {
	title: string;
	color: number;
	spoilerScores: boolean;
	/** Couleurs choisies par le serveur ; une region absente garde la sienne. */
	regionColors?: Partial<Record<string, number>>;
}

/** Forme acceptee telle quelle par discord.js (`APIEmbed`). */
export interface EsportEmbed {
	/** Petite ligne au-dessus du titre : le titre de la semaine. */
	author?: { name: string };
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

/** Details deja portes par l'intertitre du groupe, a ne pas repeter par ligne. */
interface SharedDetails {
	competition: boolean;
	format: boolean;
	stream: boolean;
}

const NOTHING_SHARED: SharedDetails = { competition: false, format: false, stream: false };

/**
 * Une competition sans le nom de sa region : sous l'intertitre « 🇪🇺 EMEA »,
 * « OWCS EMEA Stage 3 » se lit « OWCS Stage 3 ».
 */
function competitionLabel(competition: string, regionCode: string | null | undefined): string {
	const region = esportRegion(regionCode);
	// « World Finals » ou « Midseason » nomment l'evenement : rien a retirer.
	if (!region || region.code === "INTL") return competition;
	let texte = competition;
	for (const mot of [region.label, region.code, ...region.keywords]) {
		texte = texte.replace(keywordPattern(mot), "$1 ");
	}
	return texte.replace(/\s+/g, " ").trim() || competition;
}

function matchLine(
	match: EsportEmbedMatch,
	settings: EsportEmbedSettings,
	shared: SharedDetails = NOTHING_SHARED,
): string {
	const details: string[] = [];
	if (match.competition && !shared.competition) {
		details.push(`*${escapeMarkdown(competitionLabel(match.competition, match.region))}*`);
	}
	const format = esportFormatLabel(match.format, match.bestOf);
	if (format && !shared.format) details.push(format);

	if (match.finished) {
		const spoiler = esportScoreSpoiler(match, settings);
		const line = `✅ ${teamLabel(match.teamA)} ${scoreText(match, spoiler)} ${teamLabel(match.teamB)}`;
		return [line, ...details].join(" · ");
	}

	// Horodatage Discord : chaque membre lit l'heure dans son propre fuseau. La
	// lune signale un match d'apres minuit range sous la journee de la veille.
	const nuit = isEsportNight(new Date(match.scheduledAt)) ? "🌙 " : "";
	const line = `${nuit}<t:${unix(match.scheduledAt)}:t> ${teamLabel(match.teamA)} vs ${teamLabel(match.teamB)}`;
	if (match.streamUrl && !shared.stream) details.push(`[Stream](${match.streamUrl})`);
	return [line, ...details].join(" · ");
}

/** Titre de l'embed des matchs sans region, quand d'autres en ont une. */
const OTHER_REGION_TITLE = "🎮 Autres";

/** La valeur, si tous les elements la partagent (et qu'elle existe). */
function commune<T>(valeurs: readonly T[]): T | null {
	const [premiere] = valeurs;
	return premiere != null && valeurs.every((valeur) => valeur === premiere) ? premiere : null;
}

/**
 * Un champ par journee, les matchs dans l'ordre. Une journee trop chargee pour
 * un seul champ (1024 caracteres) se poursuit dans un champ « (suite) »
 * plutot que de faire refuser l'embed entier.
 */
function dayFields(
	matches: readonly EsportEmbedMatch[],
	settings: EsportEmbedSettings,
	shared: SharedDetails,
): EsportEmbed["fields"] {
	const parJour = new Map<string, string[]>();
	for (const match of matches) {
		const jour = esportDayKey(new Date(match.scheduledAt));
		parJour.set(jour, [...(parJour.get(jour) ?? []), matchLine(match, settings, shared)]);
	}

	const fields: EsportEmbed["fields"] = [];
	for (const [jour, lignes] of parJour) {
		let valeur = "";
		let suite = false;
		for (const ligne of lignes) {
			const candidate = valeur ? `${valeur}\n${ligne}` : ligne;
			if (candidate.length > FIELD_VALUE_LIMIT && valeur) {
				fields.push({ name: esportDayLabel(jour) + (suite ? " (suite)" : ""), value: valeur, inline: false });
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
	return fields;
}

/**
 * Ce que tous les matchs d'une region partagent (competition, format, stream) :
 * ecrit une fois dans la description de son embed, plus sur chaque ligne.
 */
function sharedDetails(group: readonly EsportEmbedMatch[]): { shared: SharedDetails; text: string | null } {
	const competition = commune(group.map((match) => match.competition));
	const format = commune(group.map((match) => esportFormatLabel(match.format, match.bestOf)));
	// Le stream n'est affiche que pour les matchs a venir.
	const aVenir = group.filter((match) => !match.finished);
	const stream = aVenir.length ? commune(aVenir.map((match) => match.streamUrl)) : null;

	const parts = [
		competition ? `🏆 ${escapeMarkdown(competitionLabel(competition, group[0]!.region))}` : null,
		format,
		stream ? `📺 [Stream](${stream})` : null,
	].filter((part): part is string => !!part);

	return {
		shared: { competition: !!competition, format: !!format, stream: !!stream },
		text: parts.length ? parts.join(" · ") : null,
	};
}

/**
 * Recapitulatif de la semaine : **un embed par region**, tous dans le meme
 * message, chacun avec son en-tete (titre de la semaine, region, dates) et sa
 * couleur. Discord accepte dix embeds par message ; sept regions plus
 * « Autres » y tiennent. La limite de 6000 caracteres porte sur l'ensemble
 * (`esportEmbedsSize`).
 *
 * Les regions suivent l'ordre de `ESPORT_REGIONS`, « Autres » en dernier.
 * Dans chaque embed, un champ par journee esport (qui finit a 06:00, voir
 * `ESPORT_DAY_START`). Une semaine sans aucune region garde un embed unique,
 * a la couleur des reglages. Le pied (fuseau, licence) ne figure que sur le
 * dernier embed : il vaut pour tout le message. Le lien vers la page
 * Liquipedia est dans la description de chaque region : un pied d'embed
 * n'affiche aucun lien.
 */
export function buildEsportWeekEmbeds(
	week: {
		weekStart: string;
		title: string | null;
		description: string | null;
		matches: readonly EsportEmbedMatch[];
	},
	settings: EsportEmbedSettings,
): EsportEmbed[] {
	const titreSemaine = week.title?.trim() || settings.title;
	const intro = week.description?.trim() || null;
	const range = `📅 Du ${esportDayLabel(week.weekStart).toLowerCase()} au ${esportDayLabel(
		addDaysToKey(week.weekStart, 6),
	).toLowerCase()}`;

	const pied = ["Horaires affichés dans votre fuseau horaire"];
	if (week.matches.some((match) => match.liquipediaPage)) pied.push(LIQUIPEDIA_SOURCE_LABEL);
	const footer = { text: pied.join(" · ") };

	const tries = [...week.matches].sort(
		(a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
	);

	if (!tries.some((match) => esportRegion(match.region) !== null)) {
		return [
			{
				title: titreSemaine,
				description: [
					intro,
					range,
					tries.length ? null : "Aucun match prévu cette semaine.",
					liquipediaSourceLine(tries.map((match) => match.liquipediaPage)),
				]
					.filter((part): part is string => !!part)
					.join("\n\n"),
				color: settings.color,
				fields: dayFields(tries, settings, NOTHING_SHARED),
				footer,
			},
		];
	}

	const groupes: { titre: string; color: number; matches: EsportEmbedMatch[] }[] = [
		...ESPORT_REGIONS.map((region) => ({
			titre: `${region.emoji} ${region.label}`,
			color: esportRegionColor(region.code, settings),
			matches: tries.filter((match) => match.region === region.code),
		})),
		{
			titre: OTHER_REGION_TITLE,
			color: settings.color,
			matches: tries.filter((match) => esportRegion(match.region) === null),
		},
	].filter((groupe) => groupe.matches.length);

	const embeds = groupes.map((groupe, index): EsportEmbed => {
		const details = sharedDetails(groupe.matches);
		// Chaque region cite la page de son propre tournoi : « Liquipedia » seul
		// ne dirait pas ou verifier un horaire.
		const source = liquipediaSourceLine(groupe.matches.map((match) => match.liquipediaPage));
		return {
			author: { name: titreSemaine },
			title: groupe.titre,
			// L'introduction n'est ecrite qu'une fois, en tete du message.
			description: [
				index === 0 ? intro : null,
				[range, details.text].filter(Boolean).join("\n"),
				source,
			]
				.filter((part): part is string => !!part)
				.join("\n\n"),
			color: groupe.color,
			fields: dayFields(groupe.matches, settings, details.shared),
		};
	});
	embeds[embeds.length - 1]!.footer = footer;
	return embeds;
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

	const jour = esportDayLabel(esportDayKey(new Date(match.scheduledAt)));
	const pied = [
		esportRegionLabel(match.region),
		jour,
		esportFormatLabel(match.format, match.bestOf),
		match.liquipediaPage ? LIQUIPEDIA_SOURCE_LABEL : null,
	]
		.filter((part): part is string => !!part)
		.join(" · ");

	return {
		title: match.competition
			? `🏁 Résultat — ${match.competition}`
			: "🏁 Résultat du match",
		description: [
			`${teamLabel(match.teamA)} ${scoreText(match, spoiler)} ${teamLabel(match.teamB)}`,
			verdict,
			liquipediaSourceLine([match.liquipediaPage]),
		]
			.filter((part): part is string => !!part)
			.join("\n\n"),
		color: settings.color,
		fields: [],
		footer: { text: pied },
		...(!spoiler && gagnant?.logoUrl ? { thumbnail: { url: gagnant.logoUrl } } : {}),
	};
}

/** Total de caracteres compte par Discord pour la limite de 6000. */
export function esportEmbedSize(embed: EsportEmbed): number {
	return (
		(embed.author?.name.length ?? 0) +
		embed.title.length +
		(embed.description?.length ?? 0) +
		(embed.footer?.text.length ?? 0) +
		embed.fields.reduce((total, field) => total + field.name.length + field.value.length, 0)
	);
}

/** Total d'un message a plusieurs embeds : la limite de 6000 porte sur la somme. */
export function esportEmbedsSize(embeds: readonly EsportEmbed[]): number {
	return embeds.reduce((total, embed) => total + esportEmbedSize(embed), 0);
}
