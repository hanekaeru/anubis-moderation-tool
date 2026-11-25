import { Status, type Client } from "discord.js";

/**
 * Signal de vie vers une supervision **exterieure** (Healthchecks.io ou
 * equivalent), qui previent quand les signaux s'arretent.
 *
 * C'est le seul moyen d'etre prevenu d'une panne du serveur entier : une
 * alerte emise depuis la machine se tait avec elle. Le signal n'est donc
 * jamais « je suis en panne » — c'est son **absence** qui alerte, et le delai
 * de grace se regle cote supervision, sans redeployer.
 *
 * N'est envoye que si le bot est connecte a Discord **et** vient d'ecrire son
 * battement en base (`recordHeartbeat` l'appelle apres coup) : un bot connecte
 * qui ne peut plus ecrire compte comme en panne. Rien d'autre ne part que
 * l'appel lui-meme — aucune donnee de membre ni de serveur.
 *
 * Sans `HEALTHCHECK_URL`, rien ne part : c'est le comportement d'avant.
 */

/** Un signal toutes les 5 minutes suffit, le delai d'alerte se compte en dizaines. */
export const HEALTHCHECK_INTERVAL_MS = 5 * 60_000;
const TIMEOUT_MS = 10_000;

let dernierEnvoi = 0;
/** Pour ne journaliser qu'au changement d'etat, pas toutes les 5 minutes. */
let dernierEchec: string | null = null;

/** Adresse du signal, ou `null` si absente ou invalide (on ne pingue pas au hasard). */
export function adresseDuSignal(valeur: string | undefined): string | null {
	const brute = valeur?.trim();
	if (!brute) return null;
	try {
		const url = new URL(brute);
		return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
	} catch {
		return null;
	}
}

export function doitSignaler(maintenant: number, precedent: number): boolean {
	return precedent === 0 || maintenant - precedent >= HEALTHCHECK_INTERVAL_MS;
}

/**
 * A appeler juste apres un battement ecrit avec succes. Ne leve jamais : la
 * supervision ne doit pas pouvoir faire tomber ce qu'elle surveille.
 */
export async function signalerVie(client: Client, maintenant = Date.now()): Promise<void> {
	const url = adresseDuSignal(process.env.HEALTHCHECK_URL);
	if (!url) return;
	if (client.ws.status !== Status.Ready) return;
	if (!doitSignaler(maintenant, dernierEnvoi)) return;

	// Pose avant l'appel : un appel lent ne doit pas en declencher un second
	// au battement suivant (toutes les 5 s).
	dernierEnvoi = maintenant;
	try {
		const reponse = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
		if (dernierEchec) console.log("[Supervision] Signal de vie rétabli.");
		dernierEchec = null;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (dernierEchec !== message) {
			console.error(`[Supervision] Signal de vie non envoyé : ${message}`);
		}
		dernierEchec = message;
	}
}

/** Pour les tests. */
export function reinitialiser(): void {
	dernierEnvoi = 0;
	dernierEchec = null;
}
