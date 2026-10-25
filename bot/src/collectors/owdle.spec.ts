const prismaMock = {
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

	// Deux validations simultanees : la seconde ne touche aucune ligne et ne
	// doit donc pas declencher une seconde annonce.
	it("ne compte pas une victoire deja posee entre-temps", async () => {
		prismaMock.owdleGame.updateMany.mockResolvedValue({ count: 0 });
		prismaMock.owdleGame.findUniqueOrThrow.mockResolvedValue(partie(["tracer"], NOW));

		const issue = await owdle.proposer(GUILD_ID, user, "tracer", NOW);

		expect(issue.kind).toBe("ALREADY_SOLVED");
	});

	it("n'ecrit pas de date de victoire sur un mauvais essai", async () => {
		prismaMock.owdleGame.findUniqueOrThrow.mockResolvedValue(partie(["ana"]));

		const issue = await owdle.proposer(GUILD_ID, user, "ana", NOW);

		expect(prismaMock.owdleGame.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ data: { guesses: { push: "ana" } } }),
		);
		expect(issue).toMatchObject({ kind: "PLAYED", solved: false, rank: null });
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
