import {
	XP_LEVEL_COEFFICIENT,
	levelFromXp,
	progressFromXp,
	xpRequiredForLevel,
	type XpProgress,
} from "@anubis/shared";
import { readInt } from "../env";
import prisma from "../prisma";

export interface XPManagerOptions {
	maxBufferSize?: number;
	maxWaitTime?: number;
}

/**
 * Etat d'avancement d'un membre, tel qu'affiche par `/rank`.
 *
 * La forme vit desormais dans `@anubis/shared` : le dashboard affiche la meme
 * progression, et une definition recopiee des deux cotes finirait par diverger.
 * L'alias est conserve pour ne pas reecrire les appelants du bot.
 */
export type XPProgress = XpProgress;

export interface LeaderboardRow {
	userId: string;
	xp: number;
	level: number;
	/** Position dans le classement du serveur, a partir de 1. */
	rank: number;
}

function parseBufferKey(key: string): { userId: string; guildId: string } {
	const [userId, guildId] = key.split(":");
	if (!userId || !guildId) {
		throw new Error(`Clé de buffer XP invalide : ${key}`);
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
	/**
	 * Coefficient de la courbe de niveaux : `xpRequiredForLevel(n) = 50·n·(n+1)`.
	 *
	 * Cette formule **reproduit exactement** l'ancienne table codee en dur
	 * (0, 100, 300, 600, 1000) — c'etait deja une progression triangulaire, mais
	 * arretee au niveau 4. La remplacer par sa forme close ne deplace donc aucun
	 * membre existant d'un niveau, et supprime le plafond : au-dela du niveau 4,
	 * `getXpBeforeNextLevel` renvoyait 0 et `/rank` annoncait « niveau maximal
	 * atteint » a tous les habitues du serveur.
	 *
	 * La courbe elle-meme est passee dans `@anubis/shared` : l'API calcule les
	 * paliers de recompense et le dashboard affiche la progression, il ne peut y
	 * en avoir qu'une. Les methodes statiques ci-dessous y delegent, et les
	 * tests du bot continuent de verrouiller le comportement.
	 */
	static readonly LEVEL_COEFFICIENT = XP_LEVEL_COEFFICIENT;

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

	/** XP totale exigee pour atteindre un niveau. */
	static xpRequiredForLevel(level: number): number {
		return xpRequiredForLevel(level);
	}

	/** Niveau atteint pour une quantite d'XP. */
	static levelFromXp(xp: number): number {
		return levelFromXp(xp);
	}

	static progressFromXp(xp: number): XPProgress {
		return progressFromXp(xp);
	}

	/**
	 * Ajoute de l'XP et renvoie l'avancement avant et apres.
	 *
	 * Le retour sert a detecter une montee de niveau sans relire la base : le
	 * comparer a l'exterieur imposerait deux lectures par message.
	 */
	async addXp(
		userId: string,
		guildId: string,
		xpAmount: number,
	): Promise<{ before: XPProgress; after: XPProgress }> {
		const before = XPManager.progressFromXp(await this.getXp(userId, guildId));

		const key = `${userId}:${guildId}`;
		this.buffer.set(key, (this.buffer.get(key) ?? 0) + xpAmount);

		const after = XPManager.progressFromXp(before.xp + xpAmount);

		if (this.buffer.size >= this.maxBufferSize) {
			await this.flush();
			return { before, after };
		}

		if (!this.flushTimer) {
			this.flushTimer = setTimeout(() => this.flush(), this.maxWaitTime);
		}

		return { before, after };
	}

	/**
	 * XP d'un membre, **buffer compris**.
	 *
	 * La valeur en base est en retard de tout ce qui n'a pas encore ete vide :
	 * la lire seule ferait afficher a `/rank` un total anterieur aux derniers
	 * messages du membre, et une montee de niveau resterait invisible pendant
	 * une dizaine de secondes. C'est la raison d'etre de l'instance unique
	 * partagee (`src/collectors/xp.ts`) : encore faut-il consulter son buffer.
	 */
	async getXp(userId: string, guildId: string): Promise<number> {
		const pending = this.buffer.get(`${userId}:${guildId}`) ?? 0;

		try {
			const level = await prisma.userLevel.findUnique({
				where: { userId_guildId: { userId, guildId } },
				select: { xp: true },
			});
			// L'XP est un BIGINT en base : converti ici pour que le reste du
			// code manipule un nombre ordinaire.
			return (level ? Number(level.xp) : 0) + pending;
		} catch (err) {
			console.error("[XP System] Erreur de lecture de l'XP :", err);
			return pending;
		}
	}

	async getProgress(userId: string, guildId: string): Promise<XPProgress> {
		return XPManager.progressFromXp(await this.getXp(userId, guildId));
	}

	async getLevelFromXp(xp: number): Promise<number> {
		return XPManager.levelFromXp(xp);
	}

	async getXpBeforeNextLevel(xp: number): Promise<number> {
		return XPManager.progressFromXp(xp).xpToNextLevel;
	}

	/**
	 * Position d'un membre dans le classement du serveur.
	 *
	 * Comptage plutot que tri complet : sur un serveur actif, ramener toutes les
	 * lignes pour y chercher un index couterait bien plus que de compter celles
	 * qui devancent le membre. L'XP en attente dans le buffer est prise en
	 * compte, pour que le rang concorde avec le total affiche juste a cote.
	 */
	async getRank(userId: string, guildId: string): Promise<number> {
		const xp = await this.getXp(userId, guildId);

		const ahead = await prisma.userLevel.count({
			where: { guildId, xp: { gt: BigInt(Math.floor(xp)) } },
		});

		return ahead + 1;
	}

	/** Nombre de membres ayant de l'XP sur ce serveur. */
	async countRanked(guildId: string): Promise<number> {
		return prisma.userLevel.count({ where: { guildId, xp: { gt: 0 } } });
	}

	async getLeaderboard(
		guildId: string,
		limit: number,
		offset = 0,
	): Promise<LeaderboardRow[]> {
		const rows = await prisma.userLevel.findMany({
			where: { guildId, xp: { gt: 0 } },
			// `userId` departage les ex aequo : sans second critere, deux membres
			// a egalite pourraient permuter d'une page a l'autre et l'un des deux
			// disparaitre du classement.
			orderBy: [{ xp: "desc" }, { userId: "asc" }],
			skip: offset,
			take: limit,
			select: { userId: true, xp: true },
		});

		return rows.map((row, index) => {
			const xp = Number(row.xp);
			return {
				userId: row.userId,
				xp,
				level: XPManager.levelFromXp(xp),
				rank: offset + index + 1,
			};
		});
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
				`[XP System] ${entries.length} entrée(s) enregistrée(s).`,
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
