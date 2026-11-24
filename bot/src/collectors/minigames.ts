import type { User } from "discord.js";
import {
	MINIGAME_DEFAULT_MAX_ATTEMPTS,
	MINIGAME_DEFAULT_OUT_OF_ATTEMPTS_MESSAGE,
	MINIGAME_DEFAULT_PING_TIME,
	MINIGAME_DEFAULT_TRUE_FALSE_XP,
	MINIGAME_DEFAULT_XP,
	MINIGAME_SKIN_HERO_SHARE,
	MinigameType,
	type XpProgress,
	isGuessMinigame,
	judgeSkinGuess,
	minigameDayKey,
	minigameXpDelta,
	normalizeMinigameText,
	normalizeOwdleName,
} from "@anubis/shared";
import { Prisma, type MinigameEvent } from "@anubis/shared/prisma";
import prisma from "../prisma";
import { maintenant } from "./minigameClock";
import * as referentiel from "./referentiel";
import xpManager from "./xp";

/**
 * Mini-jeux du calendrier : reglage, jeu du jour et essais de `/devine`.
 *
 * Toute la regle (comparaison approximative, meilleur des deux, verrou) vit
 * dans `@anubis/shared` ; ce module lit et ecrit la base. La reponse ne quitte
 * jamais le bot avant la fin du jeu : elle n'apparait ni dans une
 * autocompletion, ni dans un identifiant de composant.
 */

// ---------------------------------------------------------------------------
// Reglage
// ---------------------------------------------------------------------------

export interface MinigameSettings {
	announceChannelId: string | null;
	playChannelId: string | null;
	pingRoleId: string | null;
	pingTime: string;
	maxAttempts: number;
	xp: Record<"GUESS_HERO" | "GUESS_MAP" | "GUESS_SKIN", readonly number[]>;
	trueFalseXp: number;
	outOfAttemptsMessage: string;
}

/** Relu au plus toutes les 30 secondes, comme l'automod : `/devine` le lit a chaque essai. */
const CONFIG_TTL_MS = 30_000;
const configs = new Map<string, { lu: number; valeur: MinigameSettings }>();

/** Reglage du serveur, valeurs par defaut comprises : l'API rend les memes sans ligne. */
export async function reglage(guildId: string, fresh = false): Promise<MinigameSettings> {
	const cache = configs.get(guildId);
	if (!fresh && cache && Date.now() - cache.lu < CONFIG_TTL_MS) return cache.valeur;

	const row = await prisma.minigameConfig.findUnique({ where: { guildId } });
	const valeur: MinigameSettings = {
		announceChannelId: row?.announceChannelId ?? null,
		playChannelId: row?.playChannelId ?? null,
		pingRoleId: row?.pingRoleId ?? null,
		pingTime: row?.pingTime ?? MINIGAME_DEFAULT_PING_TIME,
		maxAttempts: row?.maxAttempts ?? MINIGAME_DEFAULT_MAX_ATTEMPTS,
		xp: {
			GUESS_HERO: row?.heroXp ?? MINIGAME_DEFAULT_XP.GUESS_HERO,
			GUESS_MAP: row?.mapXp ?? MINIGAME_DEFAULT_XP.GUESS_MAP,
			GUESS_SKIN: row?.skinXp ?? MINIGAME_DEFAULT_XP.GUESS_SKIN,
		},
		trueFalseXp: row?.trueFalseXp ?? MINIGAME_DEFAULT_TRUE_FALSE_XP,
		outOfAttemptsMessage: row?.outOfAttemptsMessage ?? MINIGAME_DEFAULT_OUT_OF_ATTEMPTS_MESSAGE,
	};
	configs.set(guildId, { lu: Date.now(), valeur });
	return valeur;
}

// ---------------------------------------------------------------------------
// Referentiels
// ---------------------------------------------------------------------------

interface Option {
	key: string;
	name: string;
	enabled: boolean;
}

const LISTES_TTL_MS = 30_000;
let herosEnCache: { lu: number; liste: Option[] } | null = null;
let mapsEnCache: { lu: number; liste: Option[] } | null = null;

/** Heros de l'OWdle, desactives compris : une reponse passee doit se relire. */
async function heros(): Promise<Option[]> {
	if (herosEnCache && Date.now() - herosEnCache.lu < LISTES_TTL_MS) return herosEnCache.liste;
	const liste = await prisma.owdleHero.findMany({
		select: { key: true, name: true, enabled: true },
		orderBy: { name: "asc" },
	});
	herosEnCache = { lu: Date.now(), liste };
	return liste;
}

async function maps(): Promise<Option[]> {
	if (mapsEnCache && Date.now() - mapsEnCache.lu < LISTES_TTL_MS) return mapsEnCache.liste;
	const liste = await prisma.minigameMap.findMany({
		select: { key: true, name: true, enabled: true },
		orderBy: { name: "asc" },
	});
	mapsEnCache = { lu: Date.now(), liste };
	return liste;
}

/** Pour les tests : les listes sont sinon gardees 30 secondes. */
export function viderCaches(): void {
	herosEnCache = null;
	mapsEnCache = null;
	configs.clear();
	jeux.clear();
}

/**
 * Retrouve une option a partir de la saisie. L'autocompletion envoie la cle,
 * mais elle n'est qu'une suggestion du client : un nom tape a la main doit
 * aussi passer.
 */
function resoudre(options: readonly Option[], saisie: string): Option | undefined {
	const exact = options.find((o) => o.key === saisie);
	if (exact) return exact;
	const cherche = normalizeOwdleName(saisie);
	if (!cherche) return undefined;
	return options.find((o) => normalizeOwdleName(o.name) === cherche || normalizeOwdleName(o.key) === cherche);
}

/** Options dont le nom contient la saisie, celles qui commencent par elle d'abord. */
function rechercher(options: readonly Option[], saisie: string, limit = 25): Option[] {
	const cherche = normalizeOwdleName(saisie);
	const trouves = cherche ? options.filter((o) => normalizeOwdleName(o.name).includes(cherche)) : [...options];
	trouves.sort((a, b) => {
		const aDebut = normalizeOwdleName(a.name).startsWith(cherche) ? 0 : 1;
		const bDebut = normalizeOwdleName(b.name).startsWith(cherche) ? 0 : 1;
		return aDebut - bDebut || a.name.localeCompare(b.name, "fr");
	});
	return trouves.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Jeu du jour
// ---------------------------------------------------------------------------

/**
 * Jeu du jour, garde 10 secondes : l'autocompletion le lit a chaque frappe et
 * n'a que trois secondes pour repondre. Une correction d'administrateur arrive
 * donc avec ce delai, ce qui suffit.
 */
const JEU_TTL_MS = 10_000;
const jeux = new Map<string, { lu: number; jour: string; jeu: MinigameEvent | null }>();

const versDate = (key: string) => new Date(`${key}T00:00:00Z`);

export async function jeuDuJour(guildId: string, now = maintenant()): Promise<MinigameEvent | null> {
	const jour = minigameDayKey(now);
	const cache = jeux.get(guildId);
	if (cache && cache.jour === jour && Date.now() - cache.lu < JEU_TTL_MS) return cache.jeu;

	const jeu = await prisma.minigameEvent.findUnique({ where: { guildId_day: { guildId, day: versDate(jour) } } });
	jeux.set(guildId, { lu: Date.now(), jour, jeu });
	return jeu;
}

/**
 * Suggestions de `/devine`, selon le jeu du jour. Rien pour le skin : une liste
 * de skins dévoilerait la reponse, et la saisie y est libre.
 */
export async function suggestions(guildId: string, saisie: string): Promise<{ name: string; value: string }[]> {
	const jeu = await jeuDuJour(guildId);
	if (!jeu?.publishedAt || jeu.closedAt) return [];

	const liste =
		jeu.type === MinigameType.GUESS_HERO ? await heros() : jeu.type === MinigameType.GUESS_MAP ? await maps() : null;
	if (!liste) return [];
	return rechercher(
		liste.filter((o) => o.enabled),
		saisie,
	).map((o) => ({ name: o.name, value: o.key }));
}

/** Nom affiche de la reponse d'un jeu, pour l'annonce de fin. */
export async function nomsDeReponse(jeu: MinigameEvent): Promise<{ hero: string | null; map: string | null }> {
	const hero = jeu.answerHeroKey ? (await heros()).find((h) => h.key === jeu.answerHeroKey)?.name ?? null : null;
	const map = jeu.answerMapKey ? (await maps()).find((m) => m.key === jeu.answerMapKey)?.name ?? null : null;
	return { hero, map };
}

// ---------------------------------------------------------------------------
// Essais
// ---------------------------------------------------------------------------

export interface XpGain {
	amount: number;
	before: XpProgress;
	after: XpProgress;
}

export type GuessOutcome =
	| { kind: "NO_GAME" }
	| { kind: "NOT_A_GUESS"; type: MinigameType; channelId: string | null }
	| { kind: "UNKNOWN"; type: MinigameType }
	| { kind: "ALREADY_SOLVED" }
	| { kind: "OUT_OF_ATTEMPTS"; message: string }
	| { kind: "DUPLICATE"; label: string; attemptsLeft: number }
	| { kind: "HERO_ALREADY_FOUND"; attemptsLeft: number }
	/** Deux essais envoyes au meme instant : le second est a refaire. */
	| { kind: "CONFLICT" }
	| {
			kind: "PLAYED";
			type: MinigameType;
			label: string;
			verdict: "WRONG" | "HERO" | "SOLVED";
			attemptsLeft: number;
			xp: XpGain | null;
			/** Pose quand ce coup a epuise les essais sans trouver. */
			outOfAttemptsMessage: string | null;
	  };

function estConflitUnique(err: unknown): boolean {
	return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Credite l'experience d'une bonne reponse. Une erreur ici ne doit jamais
 * faire perdre la reponse, deja enregistree.
 */
async function crediter(guildId: string, userId: string, amount: number): Promise<XpGain | null> {
	if (amount <= 0) return null;
	try {
		const { before, after } = await xpManager.addXp(userId, guildId, amount);
		return { amount, before, after };
	} catch (err) {
		console.error("[Mini-jeux] Gain d'expérience échoué :", err);
		return null;
	}
}

/** Enregistre une proposition pour le jeu du jour. */
export async function proposer(guildId: string, user: User, saisie: string, now = maintenant()): Promise<GuessOutcome> {
	const jeu = await jeuDuJour(guildId, now);
	if (!jeu?.publishedAt || jeu.closedAt) return { kind: "NO_GAME" };

	const type = jeu.type as MinigameType;
	if (!isGuessMinigame(type)) return { kind: "NOT_A_GUESS", type, channelId: jeu.channelId };

	const config = await reglage(guildId);
	const maxAttempts = jeu.maxAttempts ?? config.maxAttempts;
	const messageEpuise = jeu.outOfAttemptsMessage ?? config.outOfAttemptsMessage;

	// Ce que la saisie designe. Heros et maps doivent exister : un nom inconnu
	// ne coute pas d'essai, c'est une faute de saisie et non une reponse.
	let cle: string;
	let label: string;
	let verdict: "WRONG" | "HERO" | "SOLVED";

	if (type === MinigameType.GUESS_SKIN) {
		label = saisie.trim().slice(0, 100);
		cle = normalizeMinigameText(label);
		if (!cle) return { kind: "UNKNOWN", type };
		const hero = (await heros()).find((h) => h.key === jeu.answerHeroKey);
		const noms = hero ? [hero.name, hero.key.replace(/-/g, " ")] : [];
		const juge = judgeSkinGuess(label, jeu.answerSkin ?? "", noms);
		verdict = juge === "SKIN" ? "SOLVED" : juge;
	} else {
		const liste = type === MinigameType.GUESS_HERO ? await heros() : await maps();
		const choix = resoudre(
			liste.filter((o) => o.enabled),
			saisie,
		);
		if (!choix) return { kind: "UNKNOWN", type };
		cle = choix.key;
		label = choix.name;
		const attendue = type === MinigameType.GUESS_HERO ? jeu.answerHeroKey : jeu.answerMapKey;
		verdict = choix.key === attendue ? "SOLVED" : "WRONG";
	}

	// `user_id` porte une cle etrangere vers `discord_users`.
	await referentiel.upsertUser(user);

	const id = { eventId: jeu.id, userId: user.id };
	let partie = await prisma.minigameGame.findUnique({ where: { eventId_userId: id } });
	if (!partie) {
		try {
			partie = await prisma.minigameGame.create({ data: id });
		} catch (err) {
			if (!estConflitUnique(err)) throw err;
			partie = await prisma.minigameGame.findUniqueOrThrow({ where: { eventId_userId: id } });
		}
	}

	if (partie.solvedAt) return { kind: "ALREADY_SOLVED" };
	if (partie.attempts >= maxAttempts) return { kind: "OUT_OF_ATTEMPTS", message: messageEpuise };

	const restants = maxAttempts - partie.attempts;
	// Redonner le heros deja trouve ne coute pas d'essai : il le sait deja. Teste
	// avant le doublon, dont il est le cas le plus courant — et le message dit
	// alors ce qu'il manque.
	if (verdict === "HERO" && partie.heroFoundAt) return { kind: "HERO_ALREADY_FOUND", attemptsLeft: restants };
	if (partie.guesses.includes(cle)) return { kind: "DUPLICATE", label, attemptsLeft: restants };

	const essai = partie.attempts + 1;
	const part = verdict === "SOLVED" ? 1 : verdict === "HERO" ? MINIGAME_SKIN_HERO_SHARE : 0;
	const bareme = config.xp[type as keyof MinigameSettings["xp"]];
	// Meilleur des deux : seul l'ecart avec ce qui a deja ete verse est du.
	const gain = part ? minigameXpDelta(bareme, essai, part, partie.xpAwarded) : 0;

	// Le compteur d'essais est filtre dans le `where` : deux essais simultanes
	// ne consomment pas le meme, et une seule validation pose la victoire.
	const { count } = await prisma.minigameGame.updateMany({
		where: { ...id, attempts: partie.attempts, solvedAt: null },
		data: {
			attempts: { increment: 1 },
			guesses: { push: cle },
			xpAwarded: { increment: gain },
			...(verdict === "SOLVED" ? { solvedAt: now } : {}),
			...(verdict === "HERO" ? { heroFoundAt: now } : {}),
		},
	});
	if (count === 0) return { kind: "CONFLICT" };

	// Apres le `count` : seul l'essai qui a ete enregistre paie.
	const xp = await crediter(guildId, user.id, gain);
	const attemptsLeft = maxAttempts - essai;

	return {
		kind: "PLAYED",
		type,
		label,
		verdict,
		attemptsLeft,
		xp,
		outOfAttemptsMessage: verdict !== "SOLVED" && attemptsLeft <= 0 ? messageEpuise : null,
	};
}
