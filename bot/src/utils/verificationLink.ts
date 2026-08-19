/**
 * Composition du lien de verification Battle.net remis au membre.
 *
 * Isole et teste a part parce que la panne se produit au pire endroit : dans la
 * main d'un arrivant qui vient de cliquer, et sous la forme d'un
 * `DiscordAPIError[50035]` qui ne nomme pas la valeur fautive.
 *
 * **`new URL()` ne suffit pas a valider.** La classe WHATWG accepte des choses
 * que Discord refuse — `https:///api` (ce que produit `https://${APP_DOMAIN}/api`
 * quand la variable n'est pas substituee) est lu comme l'hote `api`, et
 * `https://${APP_DOMAIN}/api` non substitue est lu comme l'hote litteral
 * `${app_domain}`. Les deux passent `new URL()`, les deux font echouer l'envoi.
 */

/** Chemin de depart du parcours OAuth, cote API. */
const CHEMIN_DEPART = "verification/battlenet/start";

/**
 * Un hote public porte toujours un point, sauf en developpement local.
 *
 * C'est la regle qui attrape les trois formes ratees vues en pratique : hote
 * `api` (domaine vide), hote `https` (protocole en double), hote
 * `${app_domain}` (variable non substituee). Un deploiement sur un nom d'hote
 * sans point serait ecarte a tort — mais `PUBLIC_API_URL` est l'URL qu'ouvre le
 * navigateur d'un membre, jamais une adresse interne.
 */
function hotePublic(host: string): boolean {
	if (host === "localhost" || host.startsWith("localhost:")) return true;
	return host.includes(".");
}

/**
 * Rend le lien complet, ou `null` si la base est inutilisable.
 *
 * L'appelant journalise alors la valeur recue : c'est la seule information qui
 * permette de corriger la variable d'environnement sans tatonner.
 */
export function lienVerificationBattlenet(
	base: string | undefined,
	state: string,
): string | null {
	const propre = base?.trim().replace(/\/+$/, "");
	if (!propre) return null;

	let url: URL;
	try {
		// La barre finale est indispensable : sans elle, `new URL` remplace le
		// dernier segment de la base au lieu de s'y ajouter, et `/api` disparait.
		url = new URL(CHEMIN_DEPART, `${propre}/`);
	} catch {
		return null;
	}

	// Discord n'accepte que http(s) sur un bouton de lien.
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	if (!hotePublic(url.host)) return null;

	url.searchParams.set("state", state);
	return url.toString();
}
