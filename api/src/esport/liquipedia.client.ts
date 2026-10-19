import { createHash } from "node:crypto";
import {
	detectEsportRegion,
	LIQUIPEDIA_WIKI,
	type EsportMatchFormat,
	type LiquipediaMatchStatus,
	type LiquipediaTeamDto,
} from "@anubis/shared";

/**
 * Appels a l'API Liquipedia DB (v3) et lecture de ses reponses, isoles du
 * reste : le service n'a a connaitre ni l'URL, ni la syntaxe des conditions,
 * ni la forme du JSON.
 *
 * Un import ne coute qu'**un** appel : `/match` filtre par serie et par date
 * ramene toute la semaine, matchs a venir, en cours et termines. Quatre
 * pieges, chacun verifie sur le wiki Overwatch :
 * - les dates sont en **UTC**, au format `AAAA-MM-JJ HH:MM:SS`, et un match sans
 *   horaire porte le 1er janvier 1970.
 * - `parent` est la page du **tournoi** (le Stage), quand le match vit sur une
 *   sous-page (« Regular Season ») : c'est elle que l'on cite.
 * - Liquipedia n'ecrit que des « BO » : l'OWCS, joue en premier a trois, y est
 *   note `bestof=5`. La lecture en « premier a » est un reglage du serveur.
 * - un score n'a de sens qu'une fois `finished` a 1, et seulement avec le
 *   statut `S` ; les autres statuts (`W`, `FF`, `DQ`, `L`) disent un forfait.
 */

const API = "https://api.liquipedia.net/api/v3";
/** Liquipedia demande que chaque client s'identifie. */
const USER_AGENT = "AnubisDashboard/1.0 (import esport)";
const TIMEOUT_MS = 15_000;
/** Une semaine d'OWCS compte une trentaine de matchs ; la pagination est un filet. */
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

const FORFAIT = new Set(["FF", "DQ", "L"]);

export class LiquipediaError extends Error {
	constructor(message: string, readonly cause?: unknown) {
		super(message);
		this.name = "LiquipediaError";
	}
}

export interface LiquipediaRawOpponent {
	type?: string | null;
	name?: string | null;
	template?: string | null;
	icon?: string | null;
	icondark?: string | null;
	iconurl?: string | null;
	icondarkurl?: string | null;
	score?: number | string | null;
	status?: string | null;
	teamtemplate?: {
		name?: string | null;
		imageurl?: string | null;
		imagedarkurl?: string | null;
	} | null;
}

/** Champs lus dans la reponse ; le reste est garde tel quel dans le cache. */
export interface LiquipediaRawMatch {
	match2id: string;
	date?: string | null;
	dateexact?: number | string | boolean | null;
	finished?: number | string | boolean | null;
	bestof?: number | string | null;
	winner?: number | string | null;
	status?: string | null;
	stream?: Record<string, string | null> | string | null;
	parent?: string | null;
	pagename?: string | null;
	tournament?: string | null;
	tickername?: string | null;
	shortname?: string | null;
	series?: string | null;
	match2opponents?: LiquipediaRawOpponent[] | null;
	[cle: string]: unknown;
}

export interface LiquipediaMatch {
	id: string;
	series: string;
	scheduledAt: Date;
	dateExact: boolean;
	status: LiquipediaMatchStatus;
	finished: boolean;
	competition: string;
	/** Code de `ESPORT_REGIONS`, reconnu dans l'intitule ou la page du tournoi. */
	region: string | null;
	tournament: string | null;
	/** Page du tournoi, sans espaces (`Overwatch_Champions_Series/2026/EMEA/Stage_3`). */
	page: string | null;
	format: EsportMatchFormat;
	games: number | null;
	teamA: LiquipediaTeamDto | null;
	teamB: LiquipediaTeamDto | null;
	/** Manches gagnees, dans l'ordre de Liquipedia ; `null` tant que non termine. */
	score: { a: number; b: number } | null;
	forfeit: boolean;
	streamUrl: string | null;
}

const vrai = (valeur: unknown) => valeur === true || valeur === 1 || valeur === "1" || valeur === "true";

function entier(valeur: unknown): number | null {
	const nombre = typeof valeur === "number" ? valeur : typeof valeur === "string" ? Number(valeur) : NaN;
	return Number.isInteger(nombre) ? nombre : null;
}

/** `AAAA-MM-JJ HH:MM:SS`, en UTC : la forme des dates de Liquipedia. */
function lpdbDate(date: Date): string {
	return date.toISOString().slice(0, 19).replace("T", " ");
}

/** Une valeur de condition ne doit pas pouvoir refermer la condition. */
function conditionValue(valeur: string): string {
	return valeur.replace(/[[\]|]/g, "").trim();
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

/** Tous les matchs des series donnees dont la date tombe dans [from, to]. */
export async function fetchLiquipediaMatches(options: {
	apiKey: string;
	series: string[];
	from: Date;
	to: Date;
}): Promise<LiquipediaRawMatch[]> {
	const series = options.series.map(conditionValue).filter(Boolean).map((nom) => `[[series::${nom}]]`);
	const conditions = [
		// Une seule serie (le cas courant) : la condition la plus simple possible.
		series.length > 1 ? `(${series.join(" OR ")})` : series[0],
		`[[date::>${lpdbDate(options.from)}]]`,
		`[[date::<${lpdbDate(options.to)}]]`,
	].join(" AND ");

	const matches: LiquipediaRawMatch[] = [];
	for (let page = 0; page < MAX_PAGES; page++) {
		const params = new URLSearchParams({
			wiki: LIQUIPEDIA_WIKI,
			conditions,
			order: "date ASC",
			limit: String(PAGE_SIZE),
			offset: String(page * PAGE_SIZE),
			streamurls: "true",
		});

		let response: Response;
		try {
			response = await fetchWithTimeout(`${API}/match?${params.toString()}`, {
				headers: {
					Authorization: `Apikey ${options.apiKey}`,
					Accept: "application/json",
					"Accept-Encoding": "gzip",
					"User-Agent": USER_AGENT,
				},
			});
		} catch (err) {
			throw new LiquipediaError("Liquipedia est injoignable pour le moment.", err);
		}

		if (!response.ok) {
			throw new LiquipediaError(
				response.status === 401 || response.status === 403
					? "Liquipedia refuse la clé configurée sur l'API (LIQUIPEDIA_API_KEY)."
					: response.status === 429
						? "Quota de la clé Liquipedia atteint : réessayez plus tard."
						: `Liquipedia a répondu ${response.status}.`,
			);
		}

		let corps: { result?: unknown; error?: unknown };
		try {
			corps = (await response.json()) as typeof corps;
		} catch (err) {
			throw new LiquipediaError("Réponse de Liquipedia illisible.", err);
		}
		if (Array.isArray(corps.error) && corps.error.length) {
			throw new LiquipediaError(`Liquipedia a refusé la requête : ${String(corps.error[0])}`);
		}
		if (!Array.isArray(corps.result)) throw new LiquipediaError("Réponse de Liquipedia illisible.");

		const lot = (corps.result as LiquipediaRawMatch[]).filter((raw) => typeof raw?.match2id === "string");
		matches.push(...lot);
		if (corps.result.length < PAGE_SIZE) break;
	}

	return matches;
}

/**
 * Ce que le cache garde d'un match : tout, sauf les manches et les joueurs.
 * Les cartes jouees, les bans et les compositions ne servent ni a l'import ni
 * au score, et pesent plus lourd que tout le reste reuni.
 */
export function trimLiquipediaMatch(raw: LiquipediaRawMatch): LiquipediaRawMatch {
	const { match2games: _manches, ...reste } = raw;
	return {
		...reste,
		match2opponents: (raw.match2opponents ?? []).map((opponent) => {
			const { match2players: _joueurs, ...adversaire } = opponent as LiquipediaRawOpponent & {
				match2players?: unknown;
			};
			return adversaire;
		}),
	};
}

/**
 * Adresse d'un fichier de Liquipedia Commons, ou vivent les logos d'equipe.
 * MediaWiki range ses fichiers sous les deux premiers caracteres du MD5 de leur
 * nom (espaces en `_`, premiere lettre en majuscule).
 */
export function commonsFileUrl(fichier: string): string | null {
	let nom = fichier.trim().replace(/^File:/i, "").replace(/ /g, "_");
	if (!nom) return null;
	nom = nom.charAt(0).toUpperCase() + nom.slice(1);
	const hash = createHash("md5").update(nom).digest("hex");
	return `https://liquipedia.net/commons/images/${hash[0]}/${hash.slice(0, 2)}/${encodeURIComponent(nom)}`;
}

const http = (url: string | null | undefined) => (url && /^https?:\/\//.test(url) ? url : null);

function team(opponent: LiquipediaRawOpponent | undefined): LiquipediaTeamDto | null {
	const nom = opponent?.name?.trim();
	if (!nom || nom.toLowerCase() === "tbd" || opponent?.template?.toLowerCase() === "tbd") return null;
	// Discord est le plus souvent en theme sombre : le logo clair y disparait.
	const logo =
		http(opponent?.teamtemplate?.imagedarkurl) ??
		http(opponent?.icondarkurl) ??
		(opponent?.icondark ? commonsFileUrl(opponent.icondark) : null) ??
		http(opponent?.teamtemplate?.imageurl) ??
		http(opponent?.iconurl) ??
		(opponent?.icon ? commonsFileUrl(opponent.icon) : null);
	return {
		key: nom.slice(0, 120),
		name: nom.slice(0, 80),
		logoUrl: logo?.slice(0, 500) ?? null,
	};
}

/**
 * Stream a afficher : Twitch anglais d'abord, puis YouTube, puis le reste.
 * Liquipedia ecrit le plus souvent un nom de chaine plutot qu'une adresse :
 * Twitch se reconstruit, les autres passent par la page de stream du wiki.
 */
function stream(valeur: LiquipediaRawMatch["stream"]): string | null {
	let streams: Record<string, unknown> = {};
	if (typeof valeur === "string") {
		try {
			streams = JSON.parse(valeur) as Record<string, unknown>;
		} catch {
			return null;
		}
	} else if (valeur && typeof valeur === "object") {
		streams = valeur;
	}

	const rang = (cle: string) =>
		(cle.startsWith("twitch") ? 0 : cle.startsWith("youtube") ? 2 : 4) + (/_en_|^[a-z]+\d*$/.test(cle) ? 0 : 1);
	const [cle, chaine] =
		Object.entries(streams)
			.filter((entree): entree is [string, string] => typeof entree[1] === "string" && !!entree[1].trim())
			.sort(([a], [b]) => rang(a) - rang(b))[0] ?? [];
	if (!cle || !chaine) return null;

	const url = chaine.trim();
	if (/^https?:\/\//.test(url)) return url.slice(0, 500);
	const plateforme = cle.split("_")[0]!.replace(/\d+$/, "");
	if (plateforme === "twitch") return `https://www.twitch.tv/${encodeURIComponent(url)}`;
	return `https://liquipedia.net/${LIQUIPEDIA_WIKI}/Special:Stream/${plateforme}/${encodeURIComponent(url)}`.slice(
		0,
		500,
	);
}

function format(bestof: number | null, firstTo: boolean): { format: EsportMatchFormat; games: number | null } {
	if (!bestof || bestof < 1) return { format: "BEST_OF", games: null };
	// BO5 se lit FT3 : premier a la majorite des manches.
	if (firstTo && bestof > 1 && bestof % 2 === 1) {
		return { format: "FIRST_TO", games: (bestof + 1) / 2 };
	}
	return { format: "BEST_OF", games: bestof <= 9 ? bestof : null };
}

/** Score d'un match termine, ou `null` si Liquipedia ne le donne pas (nul a score inconnu). */
function score(
	raw: LiquipediaRawMatch,
	manchesGagnantes: number,
): { score: { a: number; b: number } | null; forfeit: boolean } {
	const [a, b] = raw.match2opponents ?? [];
	const statutA = a?.status?.toUpperCase() ?? "";
	const statutB = b?.status?.toUpperCase() ?? "";

	if (statutA === "S" && statutB === "S") {
		const scoreA = entier(a?.score);
		const scoreB = entier(b?.score);
		if (scoreA !== null && scoreB !== null && scoreA >= 0 && scoreB >= 0) {
			return { score: { a: scoreA, b: scoreB }, forfeit: false };
		}
		return { score: null, forfeit: false };
	}

	// Victoire par forfait : le score n'existe pas, on propose le minimum
	// qu'il fallait pour gagner. Le staff le corrige s'il en sait plus.
	const gagnant =
		statutA === "W" || FORFAIT.has(statutB)
			? 1
			: statutB === "W" || FORFAIT.has(statutA)
				? 2
				: null;
	if (!gagnant) return { score: null, forfeit: false };
	return {
		score: gagnant === 1 ? { a: manchesGagnantes, b: 0 } : { a: 0, b: manchesGagnantes },
		forfeit: true,
	};
}

/**
 * Lecture d'un match brut. `null` pour une entree inexploitable (sans horaire)
 * : elle ne peut pas etre rangee dans une semaine.
 */
export function readLiquipediaMatch(
	raw: LiquipediaRawMatch,
	options: { firstTo: boolean; now?: Date },
): LiquipediaMatch | null {
	if (!raw.date) return null;
	const scheduledAt = new Date(`${raw.date.trim().replace(" ", "T")}Z`);
	if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getUTCFullYear() < 2000) return null;

	const now = options.now ?? new Date();
	const finished = vrai(raw.finished);
	const status: LiquipediaMatchStatus =
		raw.status === "notplayed"
			? "notplayed"
			: finished
				? "finished"
				: scheduledAt.getTime() <= now.getTime()
					? "live"
					: "upcoming";

	const page = (raw.parent?.trim() || raw.pagename?.trim() || null)?.replace(/ /g, "_") ?? null;
	const tournament = raw.tournament?.trim() || null;
	const competition = (raw.tickername?.trim() || tournament || raw.series?.trim() || "Esport").slice(0, 120);
	const lecture = format(entier(raw.bestof), options.firstTo);
	const resultat =
		status === "finished"
			? score(raw, lecture.format === "FIRST_TO" ? lecture.games! : Math.ceil((lecture.games ?? 1) / 2))
			: { score: null, forfeit: false };

	return {
		id: raw.match2id,
		series: raw.series?.trim() ?? "",
		scheduledAt,
		dateExact: vrai(raw.dateexact),
		status,
		finished,
		competition,
		region: detectEsportRegion([competition, tournament, page].filter(Boolean).join(" ")),
		tournament,
		page: page?.slice(0, 255) ?? null,
		format: lecture.format,
		games: lecture.games,
		teamA: team(raw.match2opponents?.[0]),
		teamB: team(raw.match2opponents?.[1]),
		score: resultat.score,
		forfeit: resultat.forfeit,
		streamUrl: stream(raw.stream),
	};
}

/** La competition est-elle suivie ? Aucun mot-cle : toutes le sont. */
export function isFollowed(match: LiquipediaMatch, keywords: readonly string[]): boolean {
	const motsCles = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
	if (!motsCles.length) return true;
	const texte = `${match.competition} ${match.tournament ?? ""} ${match.page ?? ""}`
		.replace(/_/g, " ")
		.toLowerCase();
	return motsCles.some((motCle) => texte.includes(motCle));
}
