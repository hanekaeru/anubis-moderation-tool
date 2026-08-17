const prismaMock = {
	userLevel: {
		findUnique: jest.fn().mockResolvedValue(null),
		count: jest.fn().mockResolvedValue(0),
		findMany: jest.fn().mockResolvedValue([]),
		// Le vidage differe peut se declencher pendant la fin des tests : sans
		// cette fonction, il journalise une erreur sans rapport avec l'assertion.
		upsert: jest.fn().mockResolvedValue(undefined),
	},
	$transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
};

jest.mock("../prisma", () => ({ __esModule: true, default: prismaMock }));

import XPManager from "./xpManager";

/**
 * La courbe de niveaux est passee d'une table de cinq valeurs codees en dur a
 * une forme close. Ces tests verrouillent les deux proprietes qui comptent :
 * les paliers historiques ne bougent pas (aucun membre ne perd un niveau), et
 * la courbe reste coherente bien au-dela de l'ancien plafond.
 */
describe("xpRequiredForLevel", () => {
	it("reproduit exactement l'ancienne table codee en dur", () => {
		expect([0, 1, 2, 3, 4].map(XPManager.xpRequiredForLevel)).toEqual([
			0, 100, 300, 600, 1000,
		]);
	});

	it("ne plafonne plus au niveau 4", () => {
		expect(XPManager.xpRequiredForLevel(10)).toBe(5500);
		expect(XPManager.xpRequiredForLevel(100)).toBe(505_000);
	});
});

describe("levelFromXp", () => {
	it("place les paliers historiques sur le bon niveau", () => {
		expect(XPManager.levelFromXp(0)).toBe(0);
		expect(XPManager.levelFromXp(99)).toBe(0);
		expect(XPManager.levelFromXp(100)).toBe(1);
		expect(XPManager.levelFromXp(299)).toBe(1);
		expect(XPManager.levelFromXp(1000)).toBe(4);
	});

	it("reste l'inverse exact de xpRequiredForLevel sur mille niveaux", () => {
		for (let level = 0; level <= 1000; level += 1) {
			const seuil = XPManager.xpRequiredForLevel(level);
			const suivant = XPManager.xpRequiredForLevel(level + 1);

			// Le seuil exact appartient au niveau qu'il ouvre, et le dernier point
			// avant le seuil suivant lui appartient encore : c'est precisement la
			// ou un arrondi flottant ferait perdre un niveau.
			expect(XPManager.levelFromXp(seuil)).toBe(level);
			expect(XPManager.levelFromXp(suivant - 1)).toBe(level);
		}
	});
});

describe("progressFromXp", () => {
	it("situe le membre dans son niveau courant", () => {
		const progress = XPManager.progressFromXp(400);

		expect(progress.level).toBe(2);
		expect(progress.currentLevelXp).toBe(300);
		expect(progress.nextLevelXp).toBe(600);
		expect(progress.xpIntoLevel).toBe(100);
		expect(progress.xpForLevel).toBe(300);
		expect(progress.xpToNextLevel).toBe(200);
		expect(progress.ratio).toBeCloseTo(1 / 3);
	});
});

describe("getXp", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		prismaMock.userLevel.findUnique.mockResolvedValue({ xp: 250n });
	});

	it("ajoute l'XP encore en attente d'ecriture au total lu en base", async () => {
		const manager = new XPManager({ maxBufferSize: 100, maxWaitTime: 60_000 });

		await manager.addXp("user-1", "guild-1", 60);

		// Sans le buffer, `/rank` afficherait 250 et raterait la montee au
		// niveau 2 (300 XP) que le membre vient pourtant de franchir.
		expect(await manager.getXp("user-1", "guild-1")).toBe(310);
	});

	it("rend la montee de niveau visible dans le retour de addXp", async () => {
		const manager = new XPManager({ maxBufferSize: 100, maxWaitTime: 60_000 });

		const { before, after } = await manager.addXp("user-1", "guild-1", 60);

		expect(before.level).toBe(1);
		expect(after.level).toBe(2);
	});
});
