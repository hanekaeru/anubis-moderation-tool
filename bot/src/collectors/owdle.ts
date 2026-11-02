import type { User } from "discord.js";
import {
	OWDLE_DEFAULT_XP_BY_GUESSES,
	OWDLE_RECENT_EXCLUSION_DAYS,
	type OwdleHero,
	type XpProgress,
	addDaysToKey,
	owdleDayKey,
	owdleStreaks,
	owdleXpForGuesses,
	pickOwdleHero,
	resolveOwdleHero,
	searchOwdleHeroes,
} from "@anubis/shared";
import { Prisma } from "@anubis/shared/prisma";
import prisma from "../prisma";
import * as referentiel from "./referentiel";
import xpManager from "./xp";

/**
 * OWdle : heros du jour, parties et statistiques.
 *
 * Toute la regle du jeu (comparaison, grille, series) vit dans
 * `@anubis/shared` ; ce module ne fait que lire et ecrire la base. La reponse ne
 * le quitte jamais avant d'etre trouvee : elle n'apparait dans aucun
 * identifiant de composant ni dans aucun message.
 */

/**
 * Les heros sont relus au plus toutes les 30 secondes, comme l'automod :
 * l'autocompletion interroge la liste a chaque frappe, et une correction faite
 * depuis le dashboard doit tout de meme arriver sans redemarrage.
 */
const HEROS_TTL_MS = 30_000;
let herosEnCache: { lu: number; heros: OwdleHeroRow[] } | null = null;

/** Le heros lu en base, avec son affiliation : la grille affiche son libelle. */
type OwdleHeroRow = Prisma.OwdleHeroGetPayload<{ include: { affiliation: true } }>;

/** Tous les heros, desactives compris : une partie passee doit se relire. */
async function tousLesHeros(): Promise<OwdleHeroRow[]> {
	if (herosEnCache && Date.now() - herosEnCache.lu < HEROS_TTL_MS) return herosEnCache.heros;
	// Un libelle d'affiliation renomme depuis le dashboard arrive donc avec le
	// meme delai qu'une correction de heros.
	const heros = await prisma.owdleHero.findMany({ include: { affiliation: true }, orderBy: { name: "asc" } });
	herosEnCache = { lu: Date.now(), heros };
	return heros;
}

/** Heros qu'on peut tirer et proposer. */
async function herosActifs(): Promise<OwdleHeroRow[]> {
	return (await tousLesHeros()).filter((hero) => hero.enabled);
}

/** Suggestions de l'autocompletion, parmi les heros actifs. */
export async function suggestions(saisie: string): Promise<OwdleHero[]> {
	return searchOwdleHeroes(await herosActifs(), saisie);
}

/** Pour les tests : la liste est sinon gardee 30 secondes. */
export function viderCacheHeros(): void {
	herosEnCache = null;
}

/** `@db.Date` se lit et s'ecrit en minuit UTC : la cle `AAAA-MM-JJ` n'a pas de fuseau. */
const versDate = (key: string) => new Date(`${key}T00:00:00Z`);
const versCle = (date: Date) => date.toISOString().slice(0, 10);

function estConflitUnique(err: unknown): boolean {
	return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Heros du jour, tire a la premiere demande de la journee.
 *
 * Deux joueurs peuvent ouvrir la journee au meme instant : le second
 * `create` echoue sur la cle primaire, et l'on relit alors le tirage du
 * premier plutot que d'en imposer un autre.
 */
export async function heroDuJour(guildId: string, dayKey: string): Promise<OwdleHero> {
	const day = versDate(dayKey);
	const lire = () => prisma.owdleDay.findUnique({ where: { guildId_day: { guildId, day } } });

	let ligne = await lire();
	if (!ligne) {
		const recents = await prisma.owdleDay.findMany({
			where: { guildId, day: { gte: versDate(addDaysToKey(dayKey, -OWDLE_RECENT_EXCLUSION_DAYS)) } },
			select: { heroKey: true },
		});
		const tire = pickOwdleHero(await herosActifs(), recents.map((r) => r.heroKey));
		try {
			ligne = await prisma.owdleDay.create({ data: { guildId, day, heroKey: tire.key } });
		} catch (err) {
			if (!estConflitUnique(err)) throw err;
			ligne = await lire();
		}
	}

	// Desactive en cours de journee, le heros reste celui du jour : changer la
	// reponse sous les pieds de ceux qui ont deja joue serait pire. Les cles
	// ne se suppriment jamais, la recherche porte donc sur toute la table.
	const cle = ligne?.heroKey;
	const hero = (await tousLesHeros()).find((h) => h.key === cle);
	if (!hero) throw new Error(`[OWdle] Héros du jour inconnu : ${cle}`);
	return hero;
}

export type GuessOutcome =
	| { kind: "UNKNOWN_HERO" }
	| { kind: "ALREADY_SOLVED"; target: OwdleHero; guesses: OwdleHero[] }
	| { kind: "DUPLICATE"; hero: OwdleHero; target: OwdleHero; guesses: OwdleHero[] }
	| {
			kind: "PLAYED";
			target: OwdleHero;
			guesses: OwdleHero[];
			solved: boolean;
			/** Rang parmi les gagnants du jour, seulement a la victoire. */
			rank: number | null;
			/** Experience gagnee, seulement a la victoire et si le bareme en donne. */
			xp: XpGain | null;
		};

export interface XpGain {
	amount: number;
	before: XpProgress;
	after: XpProgress;
}

async function versHeros(keys: readonly string[]): Promise<OwdleHero[]> {
	const parCle = new Map((await tousLesHeros()).map((h) => [h.key, h]));
	return keys.map((key) => parCle.get(key)).filter((h): h is OwdleHeroRow => h !== undefined);
}

/**
 * Bareme d'experience du serveur.
 *
 * Lu sans cache : il ne sert qu'a une victoire, une fois par joueur et par
 * jour. Sans ligne, le bareme par defaut — trouver l'OWdle rapporte de
 * l'experience meme sur un serveur qui n'a jamais ouvert la page.
 */
async function bareme(guildId: string): Promise<readonly number[]> {
	const config = await prisma.owdleConfig.findUnique({ where: { guildId }, select: { xpByGuesses: true } });
	return config?.xpByGuesses ?? OWDLE_DEFAULT_XP_BY_GUESSES;
}

/**
 * Credite l'experience d'une victoire.
 *
 * Une erreur ici ne doit jamais faire perdre la victoire, deja enregistree : le
 * joueur la verrait refusee alors que l'annonce est partie.
 */
async function crediter(guildId: string, userId: string, essais: number): Promise<XpGain | null> {
	try {
		const amount = owdleXpForGuesses(await bareme(guildId), essais);
		if (amount <= 0) return null;
		const { before, after } = await xpManager.addXp(userId, guildId, amount);
		return { amount, before, after };
	} catch (err) {
		console.error("[OWdle] Gain d'expérience échoué :", err);
		return null;
	}
}

/** Enregistre un essai du joueur pour la partie du jour. */
export async function proposer(
	guildId: string,
	user: User,
	saisie: string,
	now = new Date(),
): Promise<GuessOutcome> {
	const hero = resolveOwdleHero(await herosActifs(), saisie);
	if (!hero) return { kind: "UNKNOWN_HERO" };

	const dayKey = owdleDayKey(now);
	const target = await heroDuJour(guildId, dayKey);
	const id = { guildId, userId: user.id, day: versDate(dayKey) };

	// `user_id` porte une cle etrangere vers `discord_users` : un joueur que le
	// referentiel n'a encore jamais vu ferait echouer sa premiere partie.
	await referentiel.upsertUser(user);

	let partie = await prisma.owdleGame.findUnique({ where: { guildId_userId_day: id } });
	if (!partie) {
		try {
			partie = await prisma.owdleGame.create({ data: id });
		} catch (err) {
			if (!estConflitUnique(err)) throw err;
			partie = await prisma.owdleGame.findUniqueOrThrow({ where: { guildId_userId_day: id } });
		}
	}

	if (partie.solvedAt) {
		return { kind: "ALREADY_SOLVED", target, guesses: await versHeros(partie.guesses) };
	}
	if (partie.guesses.includes(hero.key)) {
		return { kind: "DUPLICATE", hero, target, guesses: await versHeros(partie.guesses) };
	}

	const solved = hero.key === target.key;
	// Filtre sur `solvedAt: null` dans le `where` : deux validations simultanees
	// du bon heros ne doivent poser qu'une victoire, donc une seule annonce.
	const { count } = await prisma.owdleGame.updateMany({
		where: { ...id, solvedAt: null },
		data: { guesses: { push: hero.key }, ...(solved ? { solvedAt: now } : {}) },
	});

	const apres = await prisma.owdleGame.findUniqueOrThrow({ where: { guildId_userId_day: id } });
	if (count === 0) {
		return { kind: "ALREADY_SOLVED", target, guesses: await versHeros(apres.guesses) };
	}

	const rank = solved
		? await prisma.owdleGame.count({
				where: { guildId, day: id.day, solvedAt: { not: null, lte: now } },
			})
		: null;

	// Credite apres le `count` : seule la validation qui a pose la victoire
	// rapporte, deux clics simultanes ne paient pas deux fois.
	const xp = solved ? await crediter(guildId, user.id, apres.guesses.length) : null;

	return { kind: "PLAYED", target, guesses: await versHeros(apres.guesses), solved, rank, xp };
}

export interface OwdleStats {
	played: number;
	wins: number;
	/** Moyenne d'essais sur les victoires, `null` sans victoire. */
	averageGuesses: number | null;
	bestGame: number | null;
	currentStreak: number;
	bestStreak: number;
}

export async function statistiques(guildId: string, userId: string, now = new Date()): Promise<OwdleStats> {
	const parties = await prisma.owdleGame.findMany({
		where: { guildId, userId },
		select: { day: true, guesses: true, solvedAt: true },
	});

	// Une ligne sans essai n'est pas une partie jouee : elle nait au premier
	// essai, mais un essai refuse ne la remplit pas.
	const jouees = parties.filter((p) => p.guesses.length > 0);
	const gagnees = jouees.filter((p) => p.solvedAt !== null);
	const essais = gagnees.map((p) => p.guesses.length);
	const series = owdleStreaks(gagnees.map((p) => versCle(p.day)), owdleDayKey(now));

	return {
		played: jouees.length,
		wins: gagnees.length,
		averageGuesses: essais.length ? essais.reduce((a, b) => a + b, 0) / essais.length : null,
		bestGame: essais.length ? Math.min(...essais) : null,
		currentStreak: series.current,
		bestStreak: series.best,
	};
}

export interface OwdleRanking {
	userId: string;
	wins: number;
	averageGuesses: number;
}

/**
 * Classement du mois en cours : victoires d'abord, puis moyenne d'essais.
 *
 * Le nombre de victoires passe avant la moyenne : sinon un joueur qui a trouve
 * une seule fois du premier coup devancerait celui qui joue tous les jours.
 */
export async function classementDuMois(guildId: string, now = new Date(), limit = 10): Promise<OwdleRanking[]> {
	const aujourdhui = owdleDayKey(now);
	const parties = await prisma.owdleGame.findMany({
		where: {
			guildId,
			day: { gte: versDate(`${aujourdhui.slice(0, 7)}-01`), lte: versDate(aujourdhui) },
			solvedAt: { not: null },
		},
		select: { userId: true, guesses: true },
	});

	const parJoueur = new Map<string, { wins: number; total: number }>();
	for (const p of parties) {
		const cumul = parJoueur.get(p.userId) ?? { wins: 0, total: 0 };
		cumul.wins += 1;
		cumul.total += p.guesses.length;
		parJoueur.set(p.userId, cumul);
	}

	return [...parJoueur]
		.map(([userId, { wins, total }]) => ({ userId, wins, averageGuesses: total / wins }))
		.sort((a, b) => b.wins - a.wins || a.averageGuesses - b.averageGuesses)
		.slice(0, limit);
}

/** Salon d'annonce choisi, `null` = le salon de la partie. */
export async function salonAnnonce(guildId: string): Promise<string | null> {
	const config = await prisma.owdleConfig.findUnique({ where: { guildId } });
	return config?.channelId ?? null;
}

export async function definirSalonAnnonce(guildId: string, channelId: string | null): Promise<void> {
	await prisma.owdleConfig.upsert({
		where: { guildId },
		update: { channelId },
		create: { guildId, channelId },
	});
}
