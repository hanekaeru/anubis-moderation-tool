import { addDaysToKey, minigameDayKey, minigameDayStart, minigamePingInstant } from "@anubis/shared";

/**
 * Horloge des mini-jeux, deplacable en **mode test** seulement.
 *
 * Le cycle d'un jeu se lit sur l'heure de Paris : publication a minuit, ping a
 * l'heure reglee, fermeture a minuit le lendemain. Sans horloge deplacable, le
 * tester revenait a attendre trois moments de la journee, et un jour par type
 * de jeu. Ici, `/minijeu-test` fait sauter l'heure vue par le bot ; le
 * passage de cinq secondes, `/devine` et son autocompletion la lisent tous.
 *
 * Trois choix a garder :
 * - le decalage n'existe **que si `MINIGAME_TEST_MODE=true`**. Sans la
 *   variable, `maintenant()` rend l'heure reelle quoi qu'il arrive : une
 *   horloge oubliee ne peut pas publier le jeu de demain en production.
 * - il vit **en memoire**, jamais en base : un redemarrage revient a l'heure
 *   reelle, l'etat le plus sur.
 * - c'est un **decalage**, pas un instant fige : le temps continue de passer
 *   apres le saut, et une attente de quelques secondes se comporte comme en
 *   vrai (sondage, cooldown, ping).
 *
 * L'API et le dashboard restent a l'heure reelle : le verrou « veille 23:59 »
 * se teste depuis le calendrier sur de vrais jours (voir la recette).
 */

export function modeTestActif(): boolean {
	return process.env.MINIGAME_TEST_MODE === "true";
}

let decalageMs = 0;

/** L'instant vu par les mini-jeux : l'heure reelle hors mode test. */
export function maintenant(): Date {
	return new Date(Date.now() + (modeTestActif() ? decalageMs : 0));
}

/** Place l'horloge sur `instant`. Refuse hors mode test. */
export function regler(instant: Date): void {
	if (!modeTestActif()) throw new Error("Le mode test des mini-jeux n'est pas actif.");
	decalageMs = instant.getTime() - Date.now();
}

export function revenirALHeureReelle(): void {
	decalageMs = 0;
}

export function estDecalee(): boolean {
	return modeTestActif() && decalageMs !== 0;
}

export type EtapeMiniJeu = "publication" | "ping" | "fermeture";

/**
 * Instant ou se placer pour declencher une etape du jeu de `jour`, quelques
 * secondes apres son seuil : le passage du bot compare avec `>=`, et une marge
 * evite de tomber pile sur la frontiere au moment ou le passage s'execute.
 */
export const MARGE_ETAPE_MS = 5_000;

export function instantDeLEtape(jour: string, etape: EtapeMiniJeu, pingTime: string): Date {
	const seuil =
		etape === "publication"
			? minigameDayStart(jour)
			: etape === "ping"
				? minigamePingInstant(jour, pingTime)
				: minigameDayStart(addDaysToKey(jour, 1));
	return new Date(seuil.getTime() + MARGE_ETAPE_MS);
}

/** Jour de jeu courant, d'apres l'horloge des mini-jeux. */
export function jourCourant(): string {
	return minigameDayKey(maintenant());
}
