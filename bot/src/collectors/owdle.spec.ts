const heros = [
	{ key: "ana", name: "Ana", role: "SUPPORT", subRole: "TACTICIAN", species: "HUMAN", origin: "Égypte", region: "AFRICA", affiliation: { key: "overwatch", label: "Overwatch" }, releaseYear: 2016, enabled: true },
	{ key: "tracer", name: "Tracer", role: "DAMAGE", subRole: "FLANKER", species: "HUMAN", origin: "Angleterre", region: "EUROPE", affiliation: { key: "overwatch", label: "Overwatch" }, releaseYear: 2016, enabled: true },
	{ key: "mercy", name: "Ange", role: "SUPPORT", subRole: "MEDIC", species: "HUMAN", origin: "Suisse", region: "EUROPE", affiliation: { key: "overwatch", label: "Overwatch" }, releaseYear: 2016, enabled: false },
];

const prismaMock = {
	owdleHero: { findMany: jest.fn() },
	owdleConfig: { findUnique: jest.fn() },
	owdleDay: {
		findUnique: jest.fn(),
		findMany: jest.fn().mockResolvedValue([]),
		create: jest.fn(),
	},
	owdleGame: {
		findUnique: jest.fn(),
		findUniqueOrThrow: jest.fn(),
		create: jest.fn(),
		updateMany: jest.fn().mockResolvedValue({ count: 1 }),
		count: jest.fn().mockResolvedValue(1),
		findMany: jest.fn().mockResolvedValue([]),
	},
};

jest.mock("../prisma", () => ({ __esModule: true, default: prismaMock }));
jest.mock("./referentiel", () => ({ upsertUser: jest.fn().mockResolvedValue(undefined) }));

const xpMock = { addXp: jest.fn() };
jest.mock("./xp", () => ({ __esModule: true, default: xpMock }));

import type { User } from "discord.js";
import * as owdle from "./owdle";

const GUILD_ID = "guild-1";
const user = { id: "user-1" } as User;
const NOW = new Date("2026-10-25T12:00:00Z");
const DAY = new Date("2026-10-25T00:00:00Z");

function partie(guesses: string[], solvedAt: Date | null = null) {
	return { guildId: GUILD_ID, userId: user.id, day: DAY, guesses, solvedAt };
}

beforeEach(() => {
	jest.clearAllMocks();
	owdle.viderCacheHeros();
	prismaMock.owdleHero.findMany.mockResolvedValue(heros);
	prismaMock.owdleConfig.findUnique.mockResolvedValue(null);
	xpMock.addXp.mockResolvedValue({ before: { level: 1 }, after: { level: 2 } });
	prismaMock.owdleDay.findUnique.mockResolvedValue({ guildId: GUILD_ID, day: DAY, heroKey: "tracer" });
	prismaMock.owdleGame.findUnique.mockResolvedValue(partie([]));
	prismaMock.owdleGame.updateMany.mockResolvedValue({ count: 1 });
});

describe("heroDuJour", () => {
	it("tire puis enregistre le heros quand la journee n'est pas encore ouverte", async () => {
		prismaMock.owdleDay.findUnique.mockResolvedValueOnce(null);
		prismaMock.owdleDay.create.mockImplementation(({ data }) => Promise.resolve(data));

		const hero = await owdle.heroDuJour(GUILD_ID, "2026-10-25");

		expect(prismaMock.owdleDay.create).toHaveBeenCalledWith({
			data: { guildId: GUILD_ID, day: DAY, heroKey: hero.key },
		});
	});
});

describe("proposer", () => {
	it("refuse un heros inconnu sans toucher a la base", async () => {
		expect(await owdle.proposer(GUILD_ID, user, "Personne", NOW)).toEqual({ kind: "UNKNOWN_HERO" });
		expect(prismaMock.owdleGame.updateMany).not.toHaveBeenCalled();
	});

	it("refuse un heros desactive, meme tape a la main", async () => {
		expect(await owdle.proposer(GUILD_ID, user, "Ange", NOW)).toEqual({ kind: "UNKNOWN_HERO" });
	});

	it("refuse un heros deja propose", async () => {
		prismaMock.owdleGame.findUnique.mockResolvedValue(partie(["ana"]));

		const issue = await owdle.proposer(GUILD_ID, user, "ana", NOW);

		expect(issue.kind).toBe("DUPLICATE");
		expect(prismaMock.owdleGame.updateMany).not.toHaveBeenCalled();
	});

	it("pose la victoire avec un filtre sur solvedAt, pour ne l'annoncer qu'une fois", async () => {
		prismaMock.owdleGame.findUniqueOrThrow.mockResolvedValue(partie(["ana", "tracer"], NOW));
		prismaMock.owdleGame.count.mockResolvedValue(3);

		const issue = await owdle.proposer(GUILD_ID, user, "tracer", NOW);

		expect(prismaMock.owdleGame.updateMany).toHaveBeenCalledWith({
			where: { guildId: GUILD_ID, userId: user.id, day: DAY, solvedAt: null },
			data: { guesses: { push: "tracer" }, solvedAt: NOW },
		});
		expect(issue).toMatchObject({ kind: "PLAYED", solved: true, rank: 3 });
	});

	it("credite l'experience du bareme selon le nombre d'essais", async () => {
		prismaMock.owdleConfig.findUnique.mockResolvedValue({ xpByGuesses: [100, 70] });
		prismaMock.owdleGame.findUniqueOrThrow.mockResolvedValue(partie(["ana", "mercy", "tracer"], NOW));

		const issue = await owdle.proposer(GUILD_ID, user, "tracer", NOW);

		// Trois essais, bareme de deux valeurs : la derniere s'applique.
		expect(xpMock.addXp).toHaveBeenCalledWith(user.id, GUILD_ID, 70);
		expect(issue).toMatchObject({ kind: "PLAYED", xp: { amount: 70 } });
	});

	it("credite le bareme par defaut sans reglage", async () => {
		prismaMock.owdleGame.findUniqueOrThrow.mockResolvedValue(partie(["tracer"], NOW));

		await owdle.proposer(GUILD_ID, user, "tracer", NOW);

		expect(xpMock.addXp).toHaveBeenCalledWith(user.id, GUILD_ID, 100);
	});

	it("ne fait pas perdre la victoire si l'experience echoue", async () => {
		xpMock.addXp.mockRejectedValue(new Error("base indisponible"));
		prismaMock.owdleGame.findUniqueOrThrow.mockResolvedValue(partie(["tracer"], NOW));
		const erreur = jest.spyOn(console, "error").mockImplementation(() => undefined);

		const issue = await owdle.proposer(GUILD_ID, user, "tracer", NOW);

		expect(issue).toMatchObject({ kind: "PLAYED", solved: true, xp: null });
		erreur.mockRestore();
	});

	// Deux validations simultanees : la seconde ne touche aucune ligne et ne
	// doit donc pas declencher une seconde annonce.
	it("ne compte pas une victoire deja posee entre-temps", async () => {
		prismaMock.owdleGame.updateMany.mockResolvedValue({ count: 0 });
		prismaMock.owdleGame.findUniqueOrThrow.mockResolvedValue(partie(["tracer"], NOW));

		const issue = await owdle.proposer(GUILD_ID, user, "tracer", NOW);

		expect(issue.kind).toBe("ALREADY_SOLVED");
		expect(xpMock.addXp).not.toHaveBeenCalled();
	});

	it("n'ecrit pas de date de victoire sur un mauvais essai", async () => {
		prismaMock.owdleGame.findUniqueOrThrow.mockResolvedValue(partie(["ana"]));

		const issue = await owdle.proposer(GUILD_ID, user, "ana", NOW);

		expect(prismaMock.owdleGame.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ data: { guesses: { push: "ana" } } }),
		);
		expect(issue).toMatchObject({ kind: "PLAYED", solved: false, rank: null, xp: null });
		expect(xpMock.addXp).not.toHaveBeenCalled();
	});
});

describe("classementDuMois", () => {
	it("classe par victoires, puis par moyenne d'essais", async () => {
		prismaMock.owdleGame.findMany.mockResolvedValue([
			{ userId: "rapide", guesses: ["a"] },
			{ userId: "regulier", guesses: ["a", "b", "c"] },
			{ userId: "regulier", guesses: ["a", "b", "c"] },
		]);

		const lignes = await owdle.classementDuMois(GUILD_ID, NOW);

		expect(lignes.map((l) => l.userId)).toEqual(["regulier", "rapide"]);
	});
});
