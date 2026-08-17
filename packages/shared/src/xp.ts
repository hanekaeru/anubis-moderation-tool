/**
 * Courbe de niveaux du systeme d'experience.
 *
 * Elle vivait jusqu'ici dans `bot/utils/xp_manager.ts`, seul endroit qui en
 * avait besoin. Le dashboard affiche desormais la meme progression, et l'API
 * calcule les paliers de recompense : une formule recopiee a trois endroits
 * finirait par diverger, et un membre verrait un niveau different selon
 * l'ecran. `XPManager` delegue donc ici, et ses tests continuent de verrouiller
 * le comportement.
 */

/** Coefficient de la courbe : `xpRequiredForLevel(n) = 50·n·(n+1)`. */
export const XP_LEVEL_COEFFICIENT = 50;

/** XP totale exigee pour atteindre un niveau. */
export function xpRequiredForLevel(level: number): number {
	if (level <= 0) return 0;
	return XP_LEVEL_COEFFICIENT * level * (level + 1);
}

/**
 * Niveau atteint pour une quantite d'XP.
 *
 * Forme close plutot que boucle : `50·n·(n+1) ≤ xp` se resout en
 * `n = ⌊(√(1 + xp/12,5) − 1) / 2⌋`. La correction qui suit rattrape les cas ou
 * l'arrondi flottant fait basculer un membre pile sur un palier — a 100 XP
 * exactement, `Math.sqrt` peut renvoyer 2,9999999 et retirer un niveau
 * legitimement acquis.
 */
export function levelFromXp(xp: number): number {
	if (xp < xpRequiredForLevel(1)) return 0;

	const estimate = Math.floor(
		(Math.sqrt(1 + xp / (XP_LEVEL_COEFFICIENT / 4)) - 1) / 2,
	);

	if (xpRequiredForLevel(estimate + 1) <= xp) return estimate + 1;
	if (xpRequiredForLevel(estimate) > xp) return estimate - 1;
	return estimate;
}

/** Etat d'avancement d'un membre, tel qu'affiche par `/rank` et le dashboard. */
export interface XpProgress {
	xp: number;
	level: number;
	/** XP total exige pour atteindre le niveau courant. */
	currentLevelXp: number;
	/** XP total exige pour atteindre le niveau suivant. */
	nextLevelXp: number;
	/** XP acquise depuis le debut du niveau courant. */
	xpIntoLevel: number;
	/** Largeur du niveau courant, en XP. */
	xpForLevel: number;
	/** Ce qu'il reste avant le niveau suivant. */
	xpToNextLevel: number;
	/** Avancement dans le niveau courant, entre 0 et 1. */
	ratio: number;
}

export function progressFromXp(xp: number): XpProgress {
	const level = levelFromXp(xp);
	const currentLevelXp = xpRequiredForLevel(level);
	const nextLevelXp = xpRequiredForLevel(level + 1);
	const xpForLevel = nextLevelXp - currentLevelXp;
	const xpIntoLevel = xp - currentLevelXp;

	return {
		xp,
		level,
		currentLevelXp,
		nextLevelXp,
		xpIntoLevel,
		xpForLevel,
		xpToNextLevel: nextLevelXp - xp,
		ratio: xpForLevel > 0 ? xpIntoLevel / xpForLevel : 0,
	};
}
