import type { EsportMatchFormat, PandascoreTeamDto } from "@anubis/shared";

/**
 * Appels a PandaScore et lecture de leurs reponses, isoles du reste : le
 * service n'a a connaitre ni l'URL, ni les filtres, ni la forme du JSON.
 *
 * Un import ne coute qu'**un** appel : `/ow/matches` filtre par ligue et par
 * horaire prevu ramene toute la semaine, matchs a venir, en cours et termines.
 * Deux pieges, verifies sur une vraie reponse :
 * - `scheduled_at` est l'horaire prevu ; `begin_at` devient l'heure reelle de
 *   lancement une fois le match commence. Filtrer et afficher sur le second
 *   ferait bouger un match d'un jour a l'autre au gre des retards.
 * - `results` vaut 0 - 0 **avant** le match : un score n'a de sens qu'une fois
 *   `status` a `finished`.
 */

const API = "https://api.pandascore.co";
const TIMEOUT_MS = 15_000;
/** Une semaine d'OWCS compte une trentaine de matchs ; la pagination est un filet. */
const PER_PAGE = 100;
const MAX_PAGES = 5;

/**
 * Nom d'usage d'une ligue quand PandaScore en retient un autre : l'OWCS y
 * porte l'acronyme « OCS », que personne n'emploie sur le serveur.
 */
const LEAGUE_LABELS: Record<number, string> = { 5223: "OWCS" };

export class PandascoreError extends Error {
	constructor(message: string, readonly cause?: unknown) {
		super(message);
		this.name = "PandascoreError";
	}
}

/** Champs lus dans la reponse ; le reste est garde tel quel dans le cache. */
export interface PandascoreRawMatch {
	id: number;
	league_id: number;
	scheduled_at: string | null;
	rescheduled?: boolean | null;
	status?: string | null;
	match_type?: string | null;
	number_of_games?: number | null;
	forfeit?: boolean | null;
	league?: { id: number; name?: string | null } | null;
	serie?: { name?: string | null; full_name?: string | null } | null;
	tournament?: { name?: string | null } | null;
	opponents?: {
		type?: string;
		opponent?: {
			id: number;
			name?: string | null;
			acronym?: string | null;
			image_url?: string | null;
			dark_mode_image_url?: string | null;
		} | null;
	}[];
	results?: { team_id?: number | null; score?: number | null }[];
	streams_list?: {
		main?: boolean;
		official?: boolean;
		raw_url?: string | null;
	}[];
}

export interface PandascoreMatch {
	id: number;
	leagueId: number;
	scheduledAt: Date;
	rescheduled: boolean;
	status: string;
	competition: string;
	serie: string | null;
	tournament: string | null;
	format: EsportMatchFormat;
	games: number | null;
	teamA: PandascoreTeamDto | null;
	teamB: PandascoreTeamDto | null;
	/** Manches gagnees par identifiant d'equipe ; vide tant que non termine. */
	scores: Map<number, number>;
	finished: boolean;
	forfeit: boolean;
	streamUrl: string | null;
}

function iso(date: Date): string {
	return date.toISOString().replace(/\.\d{3}Z$/, "Z");
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

/** Tous les matchs des ligues donnees dont l'horaire prevu tombe dans [from, to]. */
export async function fetchOverwatchMatches(options: {
	token: string;
	leagueIds: number[];
	from: Date;
	to: Date;
}): Promise<PandascoreRawMatch[]> {
	const matches: PandascoreRawMatch[] = [];

	for (let page = 1; page <= MAX_PAGES; page++) {
		const params = new URLSearchParams({
			"filter[league_id]": options.leagueIds.join(","),
			"range[scheduled_at]": `${iso(options.from)},${iso(options.to)}`,
			sort: "scheduled_at",
			per_page: String(PER_PAGE),
			page: String(page),
		});

		let response: Response;
		try {
			response = await fetchWithTimeout(`${API}/ow/matches?${params.toString()}`, {
				headers: {
					Authorization: `Bearer ${options.token}`,
					Accept: "application/json",
				},
			});
		} catch (err) {
			throw new PandascoreError("PandaScore est injoignable pour le moment.", err);
		}

		if (!response.ok) {
			throw new PandascoreError(
				response.status === 401
					? "PandaScore refuse le jeton configuré sur l'API (PANDASCORE_TOKEN)."
					: response.status === 403
						? "Ces données ne sont pas incluses dans l'offre PandaScore du compte."
						: response.status === 429
							? "Quota horaire PandaScore atteint : réessayez dans quelques minutes."
							: `PandaScore a répondu ${response.status}.`,
			);
		}

		const lot = (await response.json()) as unknown;
		if (!Array.isArray(lot)) throw new PandascoreError("Réponse de PandaScore illisible.");

		matches.push(...(lot as PandascoreRawMatch[]));
		if (lot.length < PER_PAGE) break;
	}

	return matches;
}

function team(entry: NonNullable<PandascoreRawMatch["opponents"]>[number] | undefined): PandascoreTeamDto | null {
	const opponent = entry?.opponent;
	if (!opponent?.id) return null;
	return {
		id: opponent.id,
		name: (opponent.name?.trim() || opponent.acronym?.trim() || `Équipe ${opponent.id}`).slice(0, 80),
		acronym: opponent.acronym?.trim() || null,
		// Discord est le plus souvent en theme sombre : le logo clair y disparait.
		logoUrl: opponent.dark_mode_image_url || opponent.image_url || null,
	};
}

/** Le stream officiel principal d'abord, une rediffusion non officielle en dernier. */
function stream(list: PandascoreRawMatch["streams_list"]): string | null {
	const rang = (s: NonNullable<PandascoreRawMatch["streams_list"]>[number]) =>
		(s.official ? 2 : 0) + (s.main ? 1 : 0);
	const meilleur = [...(list ?? [])]
		.filter((s) => s.raw_url && /^https?:\/\//.test(s.raw_url))
		.sort((a, b) => rang(b) - rang(a))[0];
	return meilleur?.raw_url?.slice(0, 500) ?? null;
}

/**
 * Lecture d'un match brut. `null` pour une entree inexploitable (sans horaire
 * prevu) : elle ne peut pas etre rangee dans une semaine.
 */
export function readPandascoreMatch(raw: PandascoreRawMatch): PandascoreMatch | null {
	if (!raw.scheduled_at) return null;
	const scheduledAt = new Date(raw.scheduled_at);
	if (Number.isNaN(scheduledAt.getTime())) return null;

	const status = raw.status ?? "not_started";
	const finished = status === "finished";
	const ligue = LEAGUE_LABELS[raw.league_id] ?? raw.league?.name?.trim() ?? null;
	const serie = raw.serie?.name?.trim() || raw.serie?.full_name?.trim() || null;

	const scores = new Map<number, number>();
	if (finished) {
		for (const result of raw.results ?? []) {
			if (typeof result.team_id === "number" && typeof result.score === "number") {
				scores.set(result.team_id, result.score);
			}
		}
	}

	return {
		id: raw.id,
		leagueId: raw.league_id,
		scheduledAt,
		rescheduled: raw.rescheduled === true,
		status,
		competition: ([ligue, serie].filter(Boolean).join(" ") || "Esport").slice(0, 120),
		serie: raw.serie?.full_name?.trim() || serie,
		tournament: raw.tournament?.name?.trim() || null,
		// « first_to » : premier a N manches (l'OWCS). Les autres formats
		// (« best_of », « ow_best_of » avec manches nulles) se lisent en BO.
		format: raw.match_type === "first_to" ? "FIRST_TO" : "BEST_OF",
		games: raw.number_of_games && raw.number_of_games <= 9 ? raw.number_of_games : null,
		teamA: team(raw.opponents?.[0]),
		teamB: team(raw.opponents?.[1]),
		scores,
		finished,
		forfeit: raw.forfeit === true,
		streamUrl: stream(raw.streams_list),
	};
}

/** La serie est-elle suivie ? Aucun mot-cle : toutes le sont. */
export function isFollowed(match: PandascoreMatch, keywords: readonly string[]): boolean {
	const motsCles = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
	if (!motsCles.length) return true;
	const texte = `${match.competition} ${match.serie ?? ""} ${match.tournament ?? ""}`.toLowerCase();
	return motsCles.some((motCle) => texte.includes(motCle));
}
