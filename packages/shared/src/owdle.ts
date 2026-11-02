/**
 * OWdle — retrouver le heros du jour, a la maniere de Wordle.
 *
 * La liste des heros et la regle de comparaison vivent ici plutot que dans le
 * bot : le jour ou le dashboard affichera l'historique ou un apercu, il doit
 * comparer exactement comme le bot, sans quoi une grille partagee ne
 * correspondrait plus a ce qu'a vu le joueur.
 *
 * **Les attributs sont choisis pour etre objectifs.** Pas de points de vie (ils
 * bougent a chaque patch, la liste deviendrait fausse sans que personne ne le
 * voie), pas d'age (inconnu pour la moitie des omniaques). L'affiliation retient
 * l'appartenance **principale** : la plupart des heros en ont traverse
 * plusieurs, et c'est au staff d'arbitrer quand le lore change.
 */

import { zonedDateKey } from "./timezone";

/** Le jour de l'OWdle commence a minuit, heure de Paris, pour tout le monde. */
export const OWDLE_TIME_ZONE = "Europe/Paris";

/** Heros ecartes du tirage s'ils ont deja ete le heros du jour recemment. */
export const OWDLE_RECENT_EXCLUSION_DAYS = 30;

export type OwdleRole = "TANK" | "DAMAGE" | "SUPPORT";
export type OwdleSpecies = "HUMAN" | "OMNIC" | "ANIMAL";
export type OwdleRegion =
	| "EUROPE"
	| "AMERICAS"
	| "ASIA"
	| "AFRICA"
	| "OCEANIA"
	| "SPACE"
	| "UNKNOWN";
export type OwdleAffiliation =
	| "OVERWATCH"
	| "TALON"
	| "JUNKERS"
	| "VISHKAR"
	| "NONE"
	| "OTHER"
	| "MEKA"
	| "YOKAI";
export type OwdleWeapon = "HITSCAN" | "PROJECTILE" | "BEAM" | "MELEE";

export interface OwdleHero {
	/** Identifiant stable, stocke en base : ne jamais le renommer. */
	key: string;
	/** Nom affiche, celui du client francais. */
	name: string;
	role: OwdleRole;
	species: OwdleSpecies;
	/** Pays ou lieu d'origine, compare tel quel. */
	origin: string;
	/** Sert au 🟨 : meme continent, pays different. */
	region: OwdleRegion;
	affiliation: OwdleAffiliation;
	releaseYear: number;
	/** Tir principal, celui que l'on voit le plus. */
	weapon: OwdleWeapon;
}

export const OWDLE_ROLE_LABELS: Record<OwdleRole, string> = {
	TANK: "Tank",
	DAMAGE: "Dégâts",
	SUPPORT: "Soutien",
};

export const OWDLE_SPECIES_LABELS: Record<OwdleSpecies, string> = {
	HUMAN: "Humain",
	// Echo et Orisa sont des robots, pas des omniaques : les separer ferait deux
	// categories d'un seul membre chacune, qui donneraient la reponse.
	OMNIC: "Omniaque/robot",
	ANIMAL: "Animal",
};

export const OWDLE_AFFILIATION_LABELS: Record<OwdleAffiliation, string> = {
	OVERWATCH: "Overwatch",
	TALON: "La Griffe",
	JUNKERS: "Junkers",
	VISHKAR: "Vishkar",
	NONE: "Aucune",
	OTHER: "Autre",
	MEKA: "Escouade MEKA",
	YOKAI: "Yokai"
};

export const OWDLE_WEAPON_LABELS: Record<OwdleWeapon, string> = {
	HITSCAN: "Hitscan",
	PROJECTILE: "Projectile",
	BEAM: "Faisceau",
	MELEE: "Mêlée",
};

/**
 * Liste des heros jouables a l'OWdle.
 *
 * A jour de la saison 5 de 2026 (Doctrine, octobre 2026). En ajouter un ne
 * demande qu'une ligne, et le tirage le prend en compte des le lendemain.
 *
 * Le role suit le jeu **actuel** : un heros retravaille change de colonne (Sombra
 * est passee soutien a la saison 5 de 2026). Sa cle, elle, ne bouge jamais.
 */
export const OWDLE_HEROES: readonly OwdleHero[] = [
	// Tanks
	{ key: "dmon", name: "D.Mon", role: "TANK", species: "HUMAN", origin: "Corée du Sud", region: "ASIA", affiliation: "OTHER", releaseYear: 2026, weapon: "MELEE" },
	{ key: "domina", name: "Domina", role: "TANK", species: "HUMAN", origin: "Inde", region: "ASIA", affiliation: "VISHKAR", releaseYear: 2026, weapon: "BEAM" },
	{ key: "dva", name: "D.Va", role: "TANK", species: "HUMAN", origin: "Corée du Sud", region: "ASIA", affiliation: "OVERWATCH", releaseYear: 2016, weapon: "HITSCAN" },
	{ key: "doomfist", name: "Doomfist", role: "TANK", species: "HUMAN", origin: "Nigeria", region: "AFRICA", affiliation: "TALON", releaseYear: 2017, weapon: "MELEE" },
	{ key: "hazard", name: "Danger", role: "TANK", species: "HUMAN", origin: "Royaume-Uni", region: "EUROPE", affiliation: "OTHER", releaseYear: 2024, weapon: "PROJECTILE" },
	{ key: "junker-queen", name: "Reine des Junkers", role: "TANK", species: "HUMAN", origin: "Australie", region: "OCEANIA", affiliation: "JUNKERS", releaseYear: 2022, weapon: "HITSCAN" },
	{ key: "mauga", name: "Mauga", role: "TANK", species: "HUMAN", origin: "Samoa", region: "OCEANIA", affiliation: "TALON", releaseYear: 2023, weapon: "HITSCAN" },
	{ key: "orisa", name: "Orisa", role: "TANK", species: "OMNIC", origin: "Numbani", region: "AFRICA", affiliation: "OVERWATCH", releaseYear: 2017, weapon: "PROJECTILE" },
	{ key: "ramattra", name: "Ramattra", role: "TANK", species: "OMNIC", origin: "Népal", region: "ASIA", affiliation: "OTHER", releaseYear: 2022, weapon: "PROJECTILE" },
	{ key: "reinhardt", name: "Reinhardt", role: "TANK", species: "HUMAN", origin: "Allemagne", region: "EUROPE", affiliation: "OVERWATCH", releaseYear: 2016, weapon: "MELEE" },
	{ key: "roadhog", name: "Chopper", role: "TANK", species: "HUMAN", origin: "Australie", region: "OCEANIA", affiliation: "JUNKERS", releaseYear: 2016, weapon: "PROJECTILE" },
	{ key: "sigma", name: "Sigma", role: "TANK", species: "HUMAN", origin: "Pays-Bas", region: "EUROPE", affiliation: "TALON", releaseYear: 2019, weapon: "PROJECTILE" },
	{ key: "winston", name: "Winston", role: "TANK", species: "ANIMAL", origin: "Lune", region: "SPACE", affiliation: "OVERWATCH", releaseYear: 2016, weapon: "BEAM" },
	{ key: "wrecking-ball", name: "Bouldozer", role: "TANK", species: "ANIMAL", origin: "Lune", region: "SPACE", affiliation: "JUNKERS", releaseYear: 2018, weapon: "HITSCAN" },
	{ key: "zarya", name: "Zarya", role: "TANK", species: "HUMAN", origin: "Russie", region: "EUROPE", affiliation: "OVERWATCH", releaseYear: 2016, weapon: "BEAM" },

	// Degats
	{ key: "anran", name: "Anran", role: "DAMAGE", species: "HUMAN", origin: "Chine", region: "ASIA", affiliation: "OVERWATCH", releaseYear: 2026, weapon: "PROJECTILE" },
	{ key: "ashe", name: "Ashe", role: "DAMAGE", species: "HUMAN", origin: "États-Unis", region: "AMERICAS", affiliation: "OTHER", releaseYear: 2018, weapon: "HITSCAN" },
	{ key: "bastion", name: "Bastion", role: "DAMAGE", species: "OMNIC", origin: "Inconnue", region: "UNKNOWN", affiliation: "NONE", releaseYear: 2016, weapon: "HITSCAN" },
	// Blackwatch et le gang Deadlock plutot qu'Overwatch : avec « Overwatch »,
	// Cassidy et Soldat : 76 avaient les memes attributs et devenaient
	// impossibles a departager.
	{ key: "cassidy", name: "Cassidy", role: "DAMAGE", species: "HUMAN", origin: "États-Unis", region: "AMERICAS", affiliation: "OVERWATCH", releaseYear: 2016, weapon: "HITSCAN" },
	{ key: "echo", name: "Écho", role: "DAMAGE", species: "OMNIC", origin: "Singapour", region: "ASIA", affiliation: "OVERWATCH", releaseYear: 2020, weapon: "PROJECTILE" },
	// Ancien d'Overwatch passe chez Vendetta : c'est son camp actuel qui compte.
	{ key: "emre", name: "Emre", role: "DAMAGE", species: "HUMAN", origin: "Turquie", region: "EUROPE", affiliation: "TALON", releaseYear: 2026, weapon: "HITSCAN" },
	{ key: "freja", name: "Freja", role: "DAMAGE", species: "HUMAN", origin: "Danemark", region: "EUROPE", affiliation: "NONE", releaseYear: 2025, weapon: "PROJECTILE" },
	{ key: "genji", name: "Genji", role: "DAMAGE", species: "HUMAN", origin: "Japon", region: "ASIA", affiliation: "YOKAI", releaseYear: 2016, weapon: "PROJECTILE" },
	{ key: "hanzo", name: "Hanzo", role: "DAMAGE", species: "HUMAN", origin: "Japon", region: "ASIA", affiliation: "YOKAI", releaseYear: 2016, weapon: "PROJECTILE" },
	{ key: "junkrat", name: "Chacal", role: "DAMAGE", species: "HUMAN", origin: "Australie", region: "OCEANIA", affiliation: "JUNKERS", releaseYear: 2016, weapon: "PROJECTILE" },
	{ key: "mei", name: "Mei", role: "DAMAGE", species: "HUMAN", origin: "Chine", region: "ASIA", affiliation: "OVERWATCH", releaseYear: 2016, weapon: "BEAM" },
	{ key: "pharah", name: "Pharah", role: "DAMAGE", species: "HUMAN", origin: "Égypte", region: "AFRICA", affiliation: "OVERWATCH", releaseYear: 2016, weapon: "PROJECTILE" },
	{ key: "reaper", name: "Faucheur", role: "DAMAGE", species: "HUMAN", origin: "États-Unis", region: "AMERICAS", affiliation: "TALON", releaseYear: 2016, weapon: "HITSCAN" },
	// Le clan Hashimoto, allie de la Griffe sans en faire partie : « Autre ».
	{ key: "shion", name: "Shion", role: "DAMAGE", species: "OMNIC", origin: "Japon", region: "ASIA", affiliation: "OTHER", releaseYear: 2026, weapon: "HITSCAN" },
	{ key: "sierra", name: "Sierra", role: "DAMAGE", species: "HUMAN", origin: "États-Unis", region: "AMERICAS", affiliation: "OVERWATCH", releaseYear: 2026, weapon: "PROJECTILE" },
	{ key: "sojourn", name: "Sojourn", role: "DAMAGE", species: "HUMAN", origin: "Canada", region: "AMERICAS", affiliation: "OVERWATCH", releaseYear: 2022, weapon: "PROJECTILE" },
	{ key: "soldier-76", name: "Soldat : 76", role: "DAMAGE", species: "HUMAN", origin: "États-Unis", region: "AMERICAS", affiliation: "NONE", releaseYear: 2016, weapon: "HITSCAN" },
	{ key: "symmetra", name: "Symmetra", role: "DAMAGE", species: "HUMAN", origin: "Inde", region: "ASIA", affiliation: "VISHKAR", releaseYear: 2016, weapon: "BEAM" },
	{ key: "torbjorn", name: "Torbjörn", role: "DAMAGE", species: "HUMAN", origin: "Suède", region: "EUROPE", affiliation: "OVERWATCH", releaseYear: 2016, weapon: "PROJECTILE" },
	{ key: "tracer", name: "Tracer", role: "DAMAGE", species: "HUMAN", origin: "Angleterre", region: "EUROPE", affiliation: "OVERWATCH", releaseYear: 2016, weapon: "HITSCAN" },
	{ key: "vendetta", name: "Vendetta", role: "DAMAGE", species: "HUMAN", origin: "Italie", region: "EUROPE", affiliation: "TALON", releaseYear: 2025, weapon: "MELEE" },
	{ key: "venture", name: "Venture", role: "DAMAGE", species: "HUMAN", origin: "Canada", region: "AMERICAS", affiliation: "NONE", releaseYear: 2024, weapon: "PROJECTILE" },
	{ key: "widowmaker", name: "Fatale", role: "DAMAGE", species: "HUMAN", origin: "France", region: "EUROPE", affiliation: "TALON", releaseYear: 2016, weapon: "HITSCAN" },

	// Soutiens
	{ key: "ana", name: "Ana", role: "SUPPORT", species: "HUMAN", origin: "Égypte", region: "AFRICA", affiliation: "OVERWATCH", releaseYear: 2016, weapon: "PROJECTILE" },
	{ key: "baptiste", name: "Baptiste", role: "SUPPORT", species: "HUMAN", origin: "Haïti", region: "AMERICAS", affiliation: "OVERWATCH", releaseYear: 2019, weapon: "HITSCAN" },
	{ key: "brigitte", name: "Brigitte", role: "SUPPORT", species: "HUMAN", origin: "Suède", region: "EUROPE", affiliation: "OVERWATCH", releaseYear: 2018, weapon: "MELEE" },
	// Libere par Doomfist et les anciens de la Griffe : meme camp que lui.
	{ key: "doctrine", name: "Doctrine", role: "SUPPORT", species: "HUMAN", origin: "Zimbabwe", region: "AFRICA", affiliation: "TALON", releaseYear: 2026, weapon: "PROJECTILE" },
	{ key: "illari", name: "Illari", role: "SUPPORT", species: "HUMAN", origin: "Pérou", region: "AMERICAS", affiliation: "OTHER", releaseYear: 2023, weapon: "HITSCAN" },
	// Chatte errante recueillie a Gibraltar, dont on ne sait rien d'autre.
	{ key: "jetpack-cat", name: "Jetpack Cat", role: "SUPPORT", species: "ANIMAL", origin: "Inconnue", region: "UNKNOWN", affiliation: "OVERWATCH", releaseYear: 2026, weapon: "PROJECTILE" },
	{ key: "juno", name: "Juno", role: "SUPPORT", species: "HUMAN", origin: "Mars", region: "SPACE", affiliation: "OVERWATCH", releaseYear: 2024, weapon: "PROJECTILE" },
	{ key: "kiriko", name: "Kiriko", role: "SUPPORT", species: "HUMAN", origin: "Japon", region: "ASIA", affiliation: "YOKAI", releaseYear: 2022, weapon: "PROJECTILE" },
	{ key: "lifeweaver", name: "Vital", role: "SUPPORT", species: "HUMAN", origin: "Thaïlande", region: "ASIA", affiliation: "OTHER", releaseYear: 2023, weapon: "PROJECTILE" },
	{ key: "lucio", name: "Lúcio", role: "SUPPORT", species: "HUMAN", origin: "Brésil", region: "AMERICAS", affiliation: "OVERWATCH", releaseYear: 2016, weapon: "PROJECTILE" },
	{ key: "mercy", name: "Ange", role: "SUPPORT", species: "HUMAN", origin: "Suisse", region: "EUROPE", affiliation: "OVERWATCH", releaseYear: 2016, weapon: "BEAM" },
	{ key: "mizuki", name: "Mizuki", role: "SUPPORT", species: "HUMAN", origin: "Japon", region: "ASIA", affiliation: "OVERWATCH", releaseYear: 2026, weapon: "PROJECTILE" },
	{ key: "moira", name: "Moira", role: "SUPPORT", species: "HUMAN", origin: "Irlande", region: "EUROPE", affiliation: "TALON", releaseYear: 2017, weapon: "BEAM" },
	// Soutien depuis la saison 5 de 2026, degats auparavant.
	{ key: "sombra", name: "Sombra", role: "SUPPORT", species: "HUMAN", origin: "Mexique", region: "AMERICAS", affiliation: "TALON", releaseYear: 2016, weapon: "HITSCAN" },
	{ key: "wuyang", name: "Wuyang", role: "SUPPORT", species: "HUMAN", origin: "Chine", region: "ASIA", affiliation: "OVERWATCH", releaseYear: 2025, weapon: "PROJECTILE" },
	{ key: "zenyatta", name: "Zenyatta", role: "SUPPORT", species: "OMNIC", origin: "Népal", region: "ASIA", affiliation: "OTHER", releaseYear: 2016, weapon: "PROJECTILE" },
];

export type OwdleMatch = "EXACT" | "PARTIAL" | "WRONG";
/** Pour l'annee : `HIGHER` = le heros du jour est sorti **plus tard**. */
export type OwdleYearMatch = "EXACT" | "HIGHER" | "LOWER";

export interface OwdleComparison {
	role: OwdleMatch;
	species: OwdleMatch;
	origin: OwdleMatch;
	affiliation: OwdleMatch;
	releaseYear: OwdleYearMatch;
	weapon: OwdleMatch;
	/** Tout correspond : c'est le heros du jour. */
	solved: boolean;
}

const byKey = new Map(OWDLE_HEROES.map((hero) => [hero.key, hero]));

export function findOwdleHero(key: string): OwdleHero | undefined {
	return byKey.get(key);
}

/** Minuscules sans accents ni ponctuation : « soldat 76 » trouve « Soldat : 76 ». */
function normaliser(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}

/**
 * Retrouve un heros a partir de ce que le joueur a envoye.
 *
 * L'autocompletion envoie la cle, mais elle n'est qu'une suggestion du client :
 * un joueur peut tout aussi bien valider un nom tape a la main.
 */
export function resolveOwdleHero(input: string): OwdleHero | undefined {
	const exact = byKey.get(input);
	if (exact) return exact;

	const cherche = normaliser(input);
	if (!cherche) return undefined;
	return OWDLE_HEROES.find(
		(hero) => normaliser(hero.name) === cherche || normaliser(hero.key) === cherche,
	);
}

/** Heros dont le nom contient la saisie, au plus `limit` (25 pour Discord). */
export function searchOwdleHeroes(query: string, limit = 25): OwdleHero[] {
	const cherche = normaliser(query);
	const heros = cherche
		? OWDLE_HEROES.filter((hero) => normaliser(hero.name).includes(cherche))
		: [...OWDLE_HEROES];
	// Ceux qui commencent par la saisie d'abord : taper « re » doit proposer
	// Reinhardt avant Faucheur (reaper).
	heros.sort((a, b) => {
		const aDebut = normaliser(a.name).startsWith(cherche) ? 0 : 1;
		const bDebut = normaliser(b.name).startsWith(cherche) ? 0 : 1;
		return aDebut - bDebut || a.name.localeCompare(b.name, "fr");
	});
	return heros.slice(0, limit);
}

export function compareOwdleGuess(guess: OwdleHero, target: OwdleHero): OwdleComparison {
	const egal = <T>(a: T, b: T): OwdleMatch => (a === b ? "EXACT" : "WRONG");

	let origin: OwdleMatch = "WRONG";
	if (guess.origin === target.origin) origin = "EXACT";
	// Deux origines inconnues ne disent rien d'un continent commun.
	else if (guess.region === target.region && target.region !== "UNKNOWN") origin = "PARTIAL";

	const releaseYear: OwdleYearMatch =
		guess.releaseYear === target.releaseYear
			? "EXACT"
			: target.releaseYear > guess.releaseYear
				? "HIGHER"
				: "LOWER";

	return {
		role: egal(guess.role, target.role),
		species: egal(guess.species, target.species),
		origin,
		affiliation: egal(guess.affiliation, target.affiliation),
		releaseYear,
		weapon: egal(guess.weapon, target.weapon),
		solved: guess.key === target.key,
	};
}

const MATCH_EMOJI: Record<OwdleMatch, string> = {
	EXACT: "🟩",
	PARTIAL: "🟨",
	WRONG: "🟥",
};

const YEAR_EMOJI: Record<OwdleYearMatch, string> = {
	EXACT: "🟩",
	HIGHER: "⬆️",
	LOWER: "⬇️",
};

/**
 * Colonnes de la grille, dans l'ordre des cases.
 *
 * Chaque colonne a son icone parce que Discord affiche tout emoji a la meme
 * largeur, sur ordinateur comme sur mobile : une ligne d'icones posee au-dessus
 * des cases reste alignee avec elles, la ou des intitules en texte se
 * decalaient des que le nom d'un heros etait un peu long.
 */
export const OWDLE_COLUMNS = [
	{ icon: "🎭", label: "rôle" },
	{ icon: "🧬", label: "espèce" },
	{ icon: "🌍", label: "origine" },
	{ icon: "🚩", label: "affiliation" },
	{ icon: "📅", label: "sortie" },
	{ icon: "🎯", label: "tir principal" },
] as const;

/** En-tete de la grille : une icone au-dessus de chaque case. */
export const OWDLE_COLUMN_HEADER = OWDLE_COLUMNS.map((c) => c.icon).join("");

/** Les six cases d'un essai, sans separateur pour rester sous l'en-tete. */
function renderOwdleCells(c: OwdleComparison): string {
	return [
		MATCH_EMOJI[c.role],
		MATCH_EMOJI[c.species],
		MATCH_EMOJI[c.origin],
		MATCH_EMOJI[c.affiliation],
		YEAR_EMOJI[c.releaseYear],
		MATCH_EMOJI[c.weapon],
	].join("");
}

/**
 * Un essai, avec les valeurs : visible du seul joueur.
 *
 * Deux lignes : les cases puis le nom, et les valeurs en petit dessous. Les
 * cases ouvrent la ligne pour que la longueur du nom ne puisse jamais les
 * decaler, et les valeurs suivent l'ordre des colonnes.
 */
export function renderOwdleGuessLine(guess: OwdleHero, comparison: OwdleComparison): string {
	const valeurs = [
		OWDLE_ROLE_LABELS[guess.role],
		OWDLE_SPECIES_LABELS[guess.species],
		guess.origin,
		OWDLE_AFFILIATION_LABELS[guess.affiliation],
		String(guess.releaseYear),
		OWDLE_WEAPON_LABELS[guess.weapon],
	];
	return `${renderOwdleCells(comparison)} **${guess.name}**\n-# ${valeurs.join(" · ")}`;
}

/**
 * Grille a partager, **sans aucun nom ni valeur** : c'est elle qui part dans
 * l'annonce publique, et elle ne doit rien apprendre a ceux qui n'ont pas joue.
 * Les fleches de l'annee restent : elles disent une direction, pas une reponse.
 */
export function renderOwdleShareGrid(comparisons: readonly OwdleComparison[]): string {
	return comparisons.map(renderOwdleCells).join("\n");
}

/** Jour de l'OWdle auquel appartient un instant. */
export function owdleDayKey(instant: Date): string {
	return zonedDateKey(instant, OWDLE_TIME_ZONE);
}

/**
 * Tire le heros d'un jour, en ecartant ceux deja tombes recemment.
 *
 * Si l'exclusion videait la liste (moins de heros que de jours exclus), on
 * retombe sur la liste entiere plutot que de ne rien tirer.
 */
export function pickOwdleHero(
	recentKeys: readonly string[],
	random: () => number = Math.random,
): OwdleHero {
	const exclus = new Set(recentKeys);
	const candidats = OWDLE_HEROES.filter((hero) => !exclus.has(hero.key));
	const pool = candidats.length ? candidats : OWDLE_HEROES;
	// La liste n'est jamais vide, l'index est borne a sa taille.
	return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
}

export interface OwdleStreaks {
	current: number;
	best: number;
}

/**
 * Series de jours trouves d'affilee.
 *
 * La serie en cours survit jusqu'a la fin de la journee suivante : un joueur
 * qui n'a pas encore joue aujourd'hui ne doit pas voir sa serie remise a zero
 * a minuit pile.
 */
export function owdleStreaks(solvedKeys: readonly string[], today: string): OwdleStreaks {
	const jours = [...new Set(solvedKeys)].sort();
	const versJour = (key: string) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000;

	let best = 0;
	let run = 0;
	let precedent: number | null = null;
	for (const key of jours) {
		const jour = versJour(key);
		run = precedent !== null && jour - precedent === 1 ? run + 1 : 1;
		best = Math.max(best, run);
		precedent = jour;
	}

	const ecart = precedent === null ? Infinity : versJour(today) - precedent;
	return { current: ecart <= 1 ? run : 0, best };
}
