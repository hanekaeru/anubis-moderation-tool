import prisma from "../src/prisma";
import { readInt } from "../src/env";

export interface XPManagerOptions {
	maxBufferSize?: number;
	maxWaitTime?: number;
}

function parseBufferKey(key: string): { userId: string; guildId: string } {
	const [userId, guildId] = key.split(":");
	if (!userId || !guildId) {
		throw new Error(`Cle de buffer XP invalide : ${key}`);
	}
	return { userId, guildId };
}

/**
 * Systeme d'XP.
 *
 * L'XP est accumulee en memoire puis ecrite par lots : un message ne declenche
 * pas une ecriture. Le buffer part soit quand il atteint sa taille maximale,
 * soit apres un delai, selon ce qui arrive en premier.
 */
export class XPManager {
	static xpRequiredForLevel = [
		0, // Level 0
		100, // Level 1
		300, // Level 2
		600, // Level 3
		1000, // Level 4
	];

	static DEFAULT_MAX_BUFFER_SIZE = 50;
	static DEFAULT_MAX_WAIT_TIME = 10_000;

	private readonly buffer = new Map<string, number>();
	private readonly maxBufferSize: number;
	private readonly maxWaitTime: number;
	private flushTimer: NodeJS.Timeout | null = null;
	private isFlushing = false;

	constructor(options: XPManagerOptions = {}) {
		this.maxBufferSize =
			options.maxBufferSize ??
			readInt("MAX_BUFFER_SIZE", XPManager.DEFAULT_MAX_BUFFER_SIZE);
		this.maxWaitTime =
			options.maxWaitTime ??
			readInt(
				"MAX_WAIT_TIME_BETWEEN_FLUSH",
				XPManager.DEFAULT_MAX_WAIT_TIME,
			);
	}

	async addXp(
		userId: string,
		guildId: string,
		xpAmount: number,
	): Promise<void> {
		const key = `${userId}:${guildId}`;
		const currentXp = this.buffer.get(key) ?? 0;
		this.buffer.set(key, currentXp + xpAmount);

		if (this.buffer.size >= this.maxBufferSize) {
			await this.flush();
			return;
		}

		if (!this.flushTimer) {
			this.flushTimer = setTimeout(() => this.flush(), this.maxWaitTime);
		}
	}

	async getXp(userId: string, guildId: string): Promise<number> {
		try {
			const level = await prisma.userLevel.findUnique({
				where: { userId_guildId: { userId, guildId } },
				select: { xp: true },
			});
			// L'XP est un BIGINT en base : converti ici pour que le reste du
			// code manipule un nombre ordinaire.
			return level ? Number(level.xp) : 0;
		} catch (err) {
			console.error("[XP System] Erreur de lecture de l'XP :", err);
			return 0;
		}
	}

	async getLevelFromXp(xp: number): Promise<number> {
		return XPManager.xpRequiredForLevel.findLastIndex((val) => xp >= val);
	}

	async getXpBeforeNextLevel(xp: number): Promise<number> {
		const currentLevel = await this.getLevelFromXp(xp);
		const nextLevelXp = XPManager.xpRequiredForLevel[currentLevel + 1];
		// Dernier palier atteint : il n'y a plus de niveau suivant.
		if (nextLevelXp === undefined) return 0;
		return nextLevelXp - xp;
	}

	async flush(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		if (this.buffer.size === 0 || this.isFlushing) return;

		this.isFlushing = true;

		const entries = Array.from(this.buffer.entries());
		this.buffer.clear();

		try {
			// Une transaction d'upserts : Prisma n'a pas d'upsert en lot, mais
			// les regrouper garantit que le lot passe entierement ou pas du tout.
			await prisma.$transaction(
				entries.map(([key, xp]) => {
					const { userId, guildId } = parseBufferKey(key);
					return prisma.userLevel.upsert({
						where: { userId_guildId: { userId, guildId } },
						update: { xp: { increment: BigInt(xp) } },
						create: { userId, guildId, xp: BigInt(xp) },
					});
				}),
			);
			console.log(
				`[XP System] ${entries.length} entree(s) enregistree(s).`,
			);
		} catch (err) {
			console.error(
				"[XP System] Erreur lors de la sauvegarde BDD :",
				err,
			);
			// L'XP non ecrite retourne dans le buffer plutot que d'etre perdue.
			for (const [key, xp] of entries) {
				this.buffer.set(key, (this.buffer.get(key) ?? 0) + xp);
			}
		} finally {
			this.isFlushing = false;
		}
	}
}

export default XPManager;
