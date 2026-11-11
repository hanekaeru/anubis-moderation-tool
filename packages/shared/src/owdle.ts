/**
 * OWdle — retrouver le heros du jour, a la maniere de Wordle.
 *
 * La regle de comparaison vit ici plutot que dans le bot : le dashboard
 * verifie les heros qu'on y saisit avec les memes fonctions, sans quoi il
 * pourrait accepter une fiche que le bot lirait autrement.
 *
 * **Les heros vivent en base** (`owdle_heroes`), modifiables depuis le
 * dashboard : toutes les fonctions qui en ont besoin recoivent la liste en
 * parametre plutot que de lire une constante.
 *
 * **Les attributs sont choisis pour etre objectifs.** Pas de points de vie (ils
 * bougent a chaque patch, la liste deviendrait fausse sans que personne ne le
 * voie), pas d'age (inconnu pour la moitie des omniaques). L'affiliation retient
 * l'appartenance **principale** : la plupart des heros en ont traverse
 * plusieurs, et c'est au staff d'arbitrer quand le lore change. Le type d'arme
 * a ete remplace par le sous-role : la moitie des heros en melangeaient deux,
 * et la case se jouait sur une convention que personne ne pouvait deviner.
 */

import {
	OwdleRegion,
	OwdleRole,
	OwdleSpecies,
	OwdleSubRole,
} from "./enums";
import { zonedDateKey } from "./timezone";

/** Le jour de l'OWdle commence a minuit, heure de Paris, pour tout le monde. */
export const OWDLE_TIME_ZONE = "Europe/Paris";

/** Heros ecartes du tirage s'ils ont deja ete le heros du jour recemment. */
export const OWDLE_RECENT_EXCLUSION_DAYS = 30;

/** Cle d'un heros : minuscules, chiffres et tirets, comme `soldier-76`. */
export const OWDLE_HERO_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_OWDLE_HERO_KEY_LENGTH = 40;
export const MAX_OWDLE_HERO_NAME_LENGTH = 60;
export const MAX_OWDLE_ORIGIN_LENGTH = 60;
/** Bornes de l'annee de sortie : le jeu est sorti en 2016. */
export const MIN_OWDLE_RELEASE_YEAR = 2016;
export const MAX_OWDLE_RELEASE_YEAR = 2100;
export const MAX_OWDLE_AFFILIATION_LABEL_LENGTH = 60;

/**
 * Affiliation, telle que la table `owdle_affiliations` la porte.
 *
 * La comparaison se fait sur la `key` ; le `label` n'est qu'affiche, et le
 * renommer depuis le dashboard ne change aucune case de la grille.
 */
export interface OwdleAffiliationRef {
	key: string;
	label: string;
}

export interface OwdleHero {
	/** Identifiant stable, stocke en base : ne jamais le renommer. */
	key: string;
	/** Nom affiche, celui du client francais. */
	name: string;
	role: OwdleRole;
	/** Doit appartenir au role : voir `OWDLE_SUB_ROLE_ROLE`. */
	subRole: OwdleSubRole;
	species: OwdleSpecies;
	/** Pays ou lieu d'origine, compare tel quel. */
	origin: string;
	/** Sert au 🟨 : meme continent, pays different. */
	region: OwdleRegion;
	affiliation: OwdleAffiliationRef;
	releaseYear: number;
}

export const OWDLE_ROLE_LABELS: Record<OwdleRole, string> = {
	TANK: "Tank",
	DAMAGE: "Dégâts",
	SUPPORT: "Soutien",
};

/**
 * Role auquel appartient chaque sous-role.
 *
 * C'est ce qui empeche un « Tank Secouriste » : l'API refuse la fiche, le
 * dashboard ne propose que les sous-roles du role choisi.
 */
export const OWDLE_SUB_ROLE_ROLE: Record<OwdleSubRole, OwdleRole> = {
	BRUISER: "TANK",
	INITIATOR: "TANK",
	STALWART: "TANK",
	FLANKER: "DAMAGE",
	RECON: "DAMAGE",
	SHARPSHOOTER: "DAMAGE",
	SPECIALIST: "DAMAGE",
	MEDIC: "SUPPORT",
	SURVIVOR: "SUPPORT",
	TACTICIAN: "SUPPORT",
};

/** Noms du client francais, tels que Blizzard les a traduits. */
export const OWDLE_SUB_ROLE_LABELS: Record<OwdleSubRole, string> = {
	BRUISER: "Colosse",
	INITIATOR: "Engagement",
	STALWART: "Indéfectible",
	FLANKER: "Attaque par les flancs",
	RECON: "Reconnaissance",
	SHARPSHOOTER: "Fine gâchette",
	SPECIALIST: "Spécialiste",
	MEDIC: "Secouriste",
	SURVIVOR: "Survie",
	TACTICIAN: "Tactique",
};

/** Sous-roles d'un role, dans l'ordre de l'enum. */
export function owdleSubRolesOf(role: OwdleRole): OwdleSubRole[] {
	return Object.values(OwdleSubRole).filter((sub) => OWDLE_SUB_ROLE_ROLE[sub] === role);
}

export const OWDLE_SPECIES_LABELS: Record<OwdleSpecies, string> = {
	HUMAN: "Humain",
	// Echo et Orisa sont des robots, pas des omniaques : les separer ferait deux
	// categories d'un seul membre chacune, qui donneraient la reponse.
	OMNIC: "Omniaque/robot",
	ANIMAL: "Animal",
};

export const OWDLE_REGION_LABELS: Record<OwdleRegion, string> = {
	EUROPE: "Europe",
	AMERICAS: "Amériques",
	ASIA: "Asie",
	AFRICA: "Afrique",
	OCEANIA: "Océanie",
	SPACE: "Espace",
	UNKNOWN: "Inconnue",
};

/** Ordre des enums, pour les listes deroulantes du dashboard. */
export const OWDLE_ROLES = Object.values(OwdleRole);
export const OWDLE_SPECIES = Object.values(OwdleSpecies);
export const OWDLE_REGIONS = Object.values(OwdleRegion);

export type OwdleMatch = "EXACT" | "PARTIAL" | "WRONG";
/** Pour l'annee : `HIGHER` = le heros du jour est sorti **plus tard**. */
export type OwdleYearMatch = "EXACT" | "HIGHER" | "LOWER";

export interface OwdleComparison {
	role: OwdleMatch;
	subRole: OwdleMatch;
	species: OwdleMatch;
	origin: OwdleMatch;
	affiliation: OwdleMatch;
	releaseYear: OwdleYearMatch;
	/**
	 * C'est le heros du jour. Se lit sur la cle, pas sur les attributs : deux
	 * heros aux memes attributs ont six cases vertes sans etre le meme heros.
	 */
	solved: boolean;
}

/** Minuscules sans accents ni ponctuation : « soldat 76 » trouve « Soldat : 76 ». */
export function normalizeOwdleName(value: string): string {
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
export function resolveOwdleHero<T extends OwdleHero>(heroes: readonly T[], input: string): T | undefined {
	const exact = heroes.find((hero) => hero.key === input);
	if (exact) return exact;

	const cherche = normalizeOwdleName(input);
	if (!cherche) return undefined;
	return heroes.find(
		(hero) => normalizeOwdleName(hero.name) === cherche || normalizeOwdleName(hero.key) === cherche,
	);
}

/** Heros dont le nom contient la saisie, au plus `limit` (25 pour Discord). */
export function searchOwdleHeroes<T extends OwdleHero>(heroes: readonly T[], query: string, limit = 25): T[] {
	const cherche = normalizeOwdleName(query);
	const trouves = cherche
		? heroes.filter((hero) => normalizeOwdleName(hero.name).includes(cherche))
		: [...heroes];
	// Ceux qui commencent par la saisie d'abord : taper « re » doit proposer
	// Reinhardt avant Faucheur (reaper).
	trouves.sort((a, b) => {
		const aDebut = normalizeOwdleName(a.name).startsWith(cherche) ? 0 : 1;
		const bDebut = normalizeOwdleName(b.name).startsWith(cherche) ? 0 : 1;
		return aDebut - bDebut || a.name.localeCompare(b.name, "fr");
	});
	return trouves.slice(0, limit);
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
		subRole: egal(guess.subRole, target.subRole),
		species: egal(guess.species, target.species),
		origin,
		affiliation: egal(guess.affiliation.key, target.affiliation.key),
		releaseYear,
		solved: guess.key === target.key,
	};
}

/**
 * Groupes de heros indiscernables : memes valeurs dans toutes les colonnes.
 *
 * Ils restent jouables — une ligne toute verte qui n'est pas le heros du jour
 * coute un essai, et il ne reste que l'autre. Le dashboard les signale pour
 * qu'une faute de saisie ne fabrique pas une paire en silence.
 */
export function findOwdleTwins(heroes: readonly OwdleHero[]): string[][] {
	const groupes = new Map<string, string[]>();
	for (const h of heroes) {
		const signature = [h.role, h.subRole, h.species, h.origin, h.affiliation.key, h.releaseYear].join("|");
		groupes.set(signature, [...(groupes.get(signature) ?? []), h.key]);
	}
	return [...groupes.values()].filter((keys) => keys.length > 1);
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
 * Libelles courts de la vue d'un essai.
 *
 * Une ligne de trois paires doit tenir sur un ecran de telephone : « Attaque
 * par les flancs » la faisait deborder a elle seule. Les noms complets restent
 * ceux du dashboard (`OWDLE_SUB_ROLE_LABELS`).
 */
export const OWDLE_SUB_ROLE_SHORT_LABELS: Record<OwdleSubRole, string> = {
	BRUISER: "Colosse",
	INITIATOR: "Engagement",
	STALWART: "Indéfectible",
	FLANKER: "Flancs",
	RECON: "Reco",
	SHARPSHOOTER: "Gâchette",
	SPECIALIST: "Spécialiste",
	MEDIC: "Secouriste",
	SURVIVOR: "Survie",
	TACTICIAN: "Tactique",
};

const SPECIES_SHORT_LABELS: Record<OwdleSpecies, string> = {
	HUMAN: "Humain",
	OMNIC: "Omniaque",
	ANIMAL: "Animal",
};

/** Explication des couleurs, en une ligne : chaque case dit deja sa valeur. */
export const OWDLE_LEGEND = "🟩 juste · 🟨 même continent · 🟥 faux · ⬆️⬇️ sorti plus tard / plus tôt";

/**
 * En-tete de la grille publique : une icone par colonne, dans l'ordre des
 * cases (role, sous-role, espece, origine, affiliation, sortie).
 *
 * Il ne sert plus qu'a l'annonce publique. Sur mobile, Discord ne donne pas
 * tout a fait la meme largeur aux icones et aux carres et l'alignement glisse
 * un peu ; le proprietaire l'accepte la, ou l'on ne lit qu'une forme d'un coup
 * d'oeil. La vue privee, elle, n'en depend plus (`renderOwdleGuess`).
 */
export const OWDLE_SHARE_HEADER = "🎭🧩🧬🌍🚩📅";

/** Les six cases d'un essai, dans l'ordre de la vue detaillee. */
function renderOwdleCells(c: OwdleComparison): string[] {
	return [
		MATCH_EMOJI[c.role],
		MATCH_EMOJI[c.subRole],
		MATCH_EMOJI[c.species],
		MATCH_EMOJI[c.origin],
		MATCH_EMOJI[c.affiliation],
		YEAR_EMOJI[c.releaseYear],
	];
}

/**
 * Un essai, avec les valeurs : visible du seul joueur.
 *
 * **Chaque case porte sa valeur a cote d'elle**, en deux lignes de trois. La
 * vue precedente alignait une ligne de cases sous un en-tete d'icones : parfait
 * sur ordinateur, illisible sur mobile, ou Discord ne donne pas la meme largeur
 * aux icones et aux carres et ou l'ecart grandit de colonne en colonne. Rien
 * dans un message ne permet de forcer des colonnes ; une paire case-valeur n'a
 * besoin d'aucun alignement, et se lit pareil partout.
 */
export function renderOwdleGuess(guess: OwdleHero, comparison: OwdleComparison): string {
	const cases = renderOwdleCells(comparison);
	const valeurs = [
		OWDLE_ROLE_LABELS[guess.role],
		OWDLE_SUB_ROLE_SHORT_LABELS[guess.subRole],
		SPECIES_SHORT_LABELS[guess.species],
		guess.origin,
		guess.affiliation.label,
		String(guess.releaseYear),
	];
	const paires = valeurs.map((valeur, i) => `${cases[i]} ${valeur}`);
	return [`**${guess.name}**`, paires.slice(0, 3).join(" · "), paires.slice(3).join(" · ")].join("\n");
}

/**
 * Grille a partager, **sans aucun nom ni valeur** : c'est elle qui part dans
 * l'annonce publique, et elle ne doit rien apprendre a ceux qui n'ont pas joue.
 * Les fleches de l'annee restent : elles disent une direction, pas une reponse.
 */
export function renderOwdleShareGrid(comparisons: readonly OwdleComparison[]): string {
	return comparisons.map((c) => renderOwdleCells(c).join("")).join("\n");
}

/** Jour de l'OWdle auquel appartient un instant. */
export function owdleDayKey(instant: Date): string {
	return zonedDateKey(instant, OWDLE_TIME_ZONE);
}

/**
 * Tire le heros d'un jour, en ecartant ceux deja tombes recemment.
 *
 * Si l'exclusion videait la liste (moins de heros que de jours exclus), on
 * retombe sur la liste entiere plutot que de ne rien tirer. Une liste vide
 * leve une erreur : il n'y a alors aucun heros actif, et le dire vaut mieux
 * que de tirer `undefined`.
 */
export function pickOwdleHero<T extends OwdleHero>(
	heroes: readonly T[],
	recentKeys: readonly string[],
	random: () => number = Math.random,
): T {
	if (!heroes.length) throw new Error("[OWdle] Aucun héros actif à tirer.");

	const exclus = new Set(recentKeys);
	const candidats = heroes.filter((hero) => !exclus.has(hero.key));
	const pool = candidats.length ? candidats : heroes;
	// La liste n'est jamais vide, l'index est borne a sa taille.
	return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
}

/**
 * Bareme d'experience d'un serveur qui n'a jamais ouvert la page.
 *
 * Un message rapporte de 15 a 25 XP, une fois par minute au plus : trouver du
 * premier coup vaut donc quelques messages, pas une soiree de discussion. Le
 * jeu ne se joue qu'une fois par jour, il ne doit pas devenir la facon la plus
 * rentable de monter de niveau. Memes valeurs que le defaut de la colonne
 * `owdle_config.xp_by_guesses`.
 */
export const OWDLE_DEFAULT_XP_BY_GUESSES: readonly number[] = [100, 80, 60, 50, 40, 30];
/** Nombre de paliers du bareme : au-dela, la derniere valeur s'applique. */
export const MAX_OWDLE_XP_STEPS = 15;
export const MAX_OWDLE_XP_PER_WIN = 1000;

/**
 * Experience gagnee pour une victoire en `guesses` essais.
 *
 * La derniere valeur du bareme vaut pour tous les essais au-dela : trouver en
 * douze essais rapporte autant qu'en six. Un bareme vide ne rapporte rien.
 */
export function owdleXpForGuesses(table: readonly number[], guesses: number): number {
	if (!table.length || guesses < 1) return 0;
	return table[Math.min(guesses, table.length) - 1]!;
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
