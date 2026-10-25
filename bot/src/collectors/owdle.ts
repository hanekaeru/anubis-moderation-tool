import type { User } from "discord.js";
import {
	OWDLE_RECENT_EXCLUSION_DAYS,
	type OwdleHero,
	addDaysToKey,
	findOwdleHero,
	owdleDayKey,
	owdleStreaks,
	pickOwdleHero,
	resolveOwdleHero,
} from "@anubis/shared";
import { Prisma } from "@anubis/shared/prisma";
import prisma from "../prisma";
import * as referentiel from "./referentiel";

/**
 * OWdle : heros du jour, parties et statistiques.
 *
 * Toute la regle du jeu (comparaison, grille, series) vit dans
 * `@anubis/shared` ; ce module ne fait que lire et ecrire la base. La reponse ne
 * le quitte jamais avant d'etre trouvee : elle n'apparait dans aucun
 * identifiant de composant ni dans aucun message.
 */

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
		const tire = pickOwdleHero(recents.map((r) => r.heroKey));
		try {
			ligne = await prisma.owdleDay.create({ data: { guildId, day, heroKey: tire.key } });
		} catch (err) {
			if (!estConflitUnique(err)) throw err;
			ligne = await lire();
		}
	}

	const hero = ligne && findOwdleHero(ligne.heroKey);
	// Une cle retiree de `OWDLE_HEROES` casse la journee en cours : les cles ne
	// se renomment jamais, elles s'ajoutent.
	if (!hero) throw new Error(`[OWdle] Héros du jour inconnu : ${ligne?.heroKey}`);
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
		};

const versHeros = (keys: readonly string[]) =>
	keys.map(findOwdleHero).filter((h): h is OwdleHero => h !== undefined);

/** Enregistre un essai du joueur pour la partie du jour. */
export async function proposer(
	guildId: string,
	user: User,
	saisie: string,
	now = new Date(),
): Promise<GuessOutcome> {
	const hero = resolveOwdleHero(saisie);
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
		return { kind: "ALREADY_SOLVED", target, guesses: versHeros(partie.guesses) };
	}
	if (partie.guesses.includes(hero.key)) {
		return { kind: "DUPLICATE", hero, target, guesses: versHeros(partie.guesses) };
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
		return { kind: "ALREADY_SOLVED", target, guesses: versHeros(apres.guesses) };
	}

	const rank = solved
		? await prisma.owdleGame.count({
				where: { guildId, day: id.day, solvedAt: { not: null, lte: now } },
			})
		: null;

	return { kind: "PLAYED", target, guesses: versHeros(apres.guesses), solved, rank };
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
