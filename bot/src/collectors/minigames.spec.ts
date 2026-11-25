const prismaMock = {
	minigameConfig: { findUnique: jest.fn() },
	minigameEvent: { findUnique: jest.fn() },
	owdleHero: { findMany: jest.fn() },
	minigameMap: { findMany: jest.fn() },
	minigameGame: {
		findUnique: jest.fn(),
		findUniqueOrThrow: jest.fn(),
		create: jest.fn(),
		updateMany: jest.fn(),
	},
};

jest.mock("../prisma", () => ({ __esModule: true, default: prismaMock }));
jest.mock("./referentiel", () => ({ upsertUser: jest.fn().mockResolvedValue(undefined) }));

const xpMock = { addXp: jest.fn() };
jest.mock("./xp", () => ({ __esModule: true, default: xpMock }));

import type { User } from "discord.js";
import * as minigames from "./minigames";

const GUILD_ID = "guild-1";
const user = { id: "user-1" } as User;
const NOW = new Date("2027-01-16T12:00:00Z");

function jeu(overrides: Record<string, unknown> = {}) {
	return {
		id: "event-1",
		guildId: GUILD_ID,
		day: new Date("2027-01-16T00:00:00Z"),
		type: "GUESS_SKIN",
		answerHeroKey: "junkrat",
		answerMapKey: null,
		answerSkin: "Rat de cale",
		answerTrue: null,
		maxAttempts: null,
		outOfAttemptsMessage: null,
		channelId: "chan-1",
		publishedAt: new Date("2027-01-15T23:00:01Z"),
		closedAt: null,
		...overrides,
	};
}

function partie(overrides: Record<string, unknown> = {}) {
	return {
		eventId: "event-1",
		userId: user.id,
		guesses: [],
		attempts: 0,
		heroFoundAt: null,
		solvedAt: null,
		xpAwarded: 0,
		...overrides,
	};
}

beforeEach(() => {
	jest.clearAllMocks();
	minigames.viderCaches();
	// Bareme du skin fixe pour le test : 100 / 60 / 30.
	prismaMock.minigameConfig.findUnique.mockResolvedValue({
		announceChannelId: null,
		playChannelId: null,
		pingRoleId: null,
		pingTime: "09:00",
		maxAttempts: 3,
		heroXp: [60, 40, 20],
		mapXp: [60, 40, 20],
		skinXp: [100, 60, 30],
		trueFalseXp: 15,
		outOfAttemptsMessage: null,
	});
	prismaMock.minigameEvent.findUnique.mockResolvedValue(jeu());
	prismaMock.owdleHero.findMany.mockResolvedValue([
		{ key: "junkrat", name: "Chacal", enabled: true },
		{ key: "ana", name: "Ana", enabled: true },
	]);
	prismaMock.minigameMap.findMany.mockResolvedValue([{ key: "dorado", name: "Dorado", enabled: true }]);
	prismaMock.minigameGame.findUnique.mockResolvedValue(partie());
	prismaMock.minigameGame.updateMany.mockResolvedValue({ count: 1 });
	xpMock.addXp.mockImplementation((_u, _g, amount) =>
		Promise.resolve({ before: { level: 1, xp: 0 }, after: { level: 1, xp: amount } }),
	);
});

describe("proposer — devine le skin", () => {
	it("verse la moitie pour le heros seul et laisse continuer", async () => {
		const issue = await minigames.proposer(GUILD_ID, user, "chacal", NOW);
		expect(issue).toEqual(expect.objectContaining({ kind: "PLAYED", verdict: "HERO", attemptsLeft: 2 }));
		expect(xpMock.addXp).toHaveBeenCalledWith(user.id, GUILD_ID, 50);
	});

	it("ne verse que l'ecart quand le skin suit le heros (meilleur des deux)", async () => {
		prismaMock.minigameGame.findUnique.mockResolvedValue(
			partie({ guesses: ["chacal"], attempts: 1, heroFoundAt: NOW, xpAwarded: 50 }),
		);
		const issue = await minigames.proposer(GUILD_ID, user, "Rat de calle", NOW);
		expect(issue).toEqual(expect.objectContaining({ kind: "PLAYED", verdict: "SOLVED" }));
		expect(xpMock.addXp).toHaveBeenCalledWith(user.id, GUILD_ID, 10);
	});

	it("ne fait pas payer d'essai pour redonner le heros deja trouve", async () => {
		prismaMock.minigameGame.findUnique.mockResolvedValue(
			partie({ guesses: ["chacal"], attempts: 1, heroFoundAt: NOW, xpAwarded: 50 }),
		);
		const issue = await minigames.proposer(GUILD_ID, user, "Chacal !", NOW);
		expect(issue.kind).toBe("HERO_ALREADY_FOUND");
		expect(prismaMock.minigameGame.updateMany).not.toHaveBeenCalled();
	});

	it("bloque apres le dernier essai avec le message personnalise", async () => {
		prismaMock.minigameEvent.findUnique.mockResolvedValue(jeu({ outOfAttemptsMessage: "Fini pour toi !" }));
		prismaMock.minigameGame.findUnique.mockResolvedValue(partie({ guesses: ["a", "b"], attempts: 2 }));
		const dernier = await minigames.proposer(GUILD_ID, user, "pirate", NOW);
		expect(dernier).toEqual(expect.objectContaining({ verdict: "WRONG", outOfAttemptsMessage: "Fini pour toi !" }));

		prismaMock.minigameGame.findUnique.mockResolvedValue(partie({ guesses: ["a", "b", "pirate"], attempts: 3 }));
		expect(await minigames.proposer(GUILD_ID, user, "autre", NOW)).toEqual({
			kind: "OUT_OF_ATTEMPTS",
			message: "Fini pour toi !",
		});
	});

	it("filtre le compteur d'essais pour ecarter deux essais simultanes", async () => {
		prismaMock.minigameGame.updateMany.mockResolvedValue({ count: 0 });
		expect((await minigames.proposer(GUILD_ID, user, "pirate", NOW)).kind).toBe("CONFLICT");
		expect(prismaMock.minigameGame.updateMany.mock.calls[0][0].where).toEqual(
			expect.objectContaining({ attempts: 0, solvedAt: null }),
		);
		expect(xpMock.addXp).not.toHaveBeenCalled();
	});
});

describe("proposer — devine la map", () => {
	beforeEach(() => {
		prismaMock.minigameEvent.findUnique.mockResolvedValue(
			jeu({ type: "GUESS_MAP", answerHeroKey: null, answerSkin: null, answerMapKey: "dorado" }),
		);
	});

	it("ne compte pas d'essai pour une map inconnue", async () => {
		expect((await minigames.proposer(GUILD_ID, user, "Atlantide", NOW)).kind).toBe("UNKNOWN");
		expect(prismaMock.minigameGame.updateMany).not.toHaveBeenCalled();
	});

	it("paie le premier palier du premier coup", async () => {
		const issue = await minigames.proposer(GUILD_ID, user, "dorado", NOW);
		expect(issue).toEqual(expect.objectContaining({ verdict: "SOLVED", label: "Dorado" }));
		expect(xpMock.addXp).toHaveBeenCalledWith(user.id, GUILD_ID, 60);
	});
});

describe("proposer — hors jeu", () => {
	it("refuse quand le jeu n'est pas encore publie", async () => {
		prismaMock.minigameEvent.findUnique.mockResolvedValue(jeu({ publishedAt: null }));
		expect(await minigames.proposer(GUILD_ID, user, "x", NOW)).toEqual({ kind: "NO_GAME" });
	});

	it("renvoie au sondage un jour de vrai ou faux", async () => {
		prismaMock.minigameEvent.findUnique.mockResolvedValue(jeu({ type: "TRUE_FALSE" }));
		expect((await minigames.proposer(GUILD_ID, user, "vrai", NOW)).kind).toBe("NOT_A_GUESS");
	});
});
