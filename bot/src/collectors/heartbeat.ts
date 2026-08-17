import type { Client } from "discord.js";
import prisma from "../prisma";

/**
 * Battement de coeur du process bot.
 *
 * Rien d'autre ne dit a l'API si le bot tourne : elle ne lui parle jamais
 * directement, les deux ne partagent que la base. Une ligne recente vaut donc
 * "en ligne", une ligne trop vieille (ou absente) vaut "hors ligne" — c'est ce
 * que lit la page de statut de la webapp.
 */

/** Ligne unique : le battement decrit le process, pas un serveur Discord. */
const HEARTBEAT_ID = "bot";

/** Echantillons gardes pour la moyenne glissante (5s x 60 = 5 min). */
const PING_SAMPLE_SIZE = 60;

const pingSamples: number[] = [];

/** `client.ws.ping` vaut -1 tant que la passerelle n'a pas repondu une fois. */
function normalizePing(ping: number): number | null {
	if (!Number.isFinite(ping) || ping < 0) return null;
	return Math.round(ping);
}

function averagePing(): number | null {
	if (pingSamples.length === 0) return null;
	const total = pingSamples.reduce((sum, value) => sum + value, 0);
	return Math.round(total / pingSamples.length);
}

/**
 * Dernier battement ecrit par l'execution precedente, ou `null` au tout premier
 * demarrage. A lire **avant** le premier `recordHeartbeat`, qui l'ecrase.
 *
 * Sert de date de fin plausible a ce qui est reste ouvert pendant l'arret (voir
 * `collectors/voice.ts`).
 */
export async function lastKnownHeartbeat(): Promise<Date | null> {
	const row = await prisma.botHeartbeat.findUnique({
		where: { id: HEARTBEAT_ID },
		select: { lastHeartbeatAt: true },
	});
	return row?.lastHeartbeatAt ?? null;
}

export async function recordHeartbeat(client: Client): Promise<void> {
	const wsPingMs = normalizePing(client.ws.ping);

	if (wsPingMs !== null) {
		pingSamples.push(wsPingMs);
		if (pingSamples.length > PING_SAMPLE_SIZE) pingSamples.shift();
	}

	// `readyAt` est l'instant de connexion de CE process : le reecrire a chaque
	// battement fait repartir l'uptime a zero apres un redemarrage, ce qui est
	// exactement le comportement attendu.
	const startedAt = client.readyAt ?? new Date();
	const data = {
		startedAt,
		lastHeartbeatAt: new Date(),
		wsPingMs,
		avgPingMs: averagePing(),
		guildCount: client.guilds.cache.size,
	};

	await prisma.botHeartbeat.upsert({
		where: { id: HEARTBEAT_ID },
		update: data,
		create: { id: HEARTBEAT_ID, ...data },
	});
}
