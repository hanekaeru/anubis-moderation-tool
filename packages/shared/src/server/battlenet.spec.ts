import { unlinkBattlenet } from "./battlenet";

const GUILD_ID = "1534550360180396132";
const USER_ID = "136122497891303425";
const APP_USER_ID = "00000000-0000-0000-0000-000000000001";

function lien(overrides: Record<string, unknown> = {}) {
	return {
		battlenetHash: "a".repeat(64),
		userId: USER_ID,
		unlinkedAt: null,
		...overrides,
	};
}

function makeDb(options: {
	lignes?: Record<string, unknown>[];
	statut?: Record<string, unknown> | null;
} = {}) {
	return {
		battlenetAccount: {
			findMany: jest.fn().mockResolvedValue(options.lignes ?? [lien()]),
			update: jest.fn().mockResolvedValue({}),
			deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
		},
		quarantineConfig: {
			findUnique: jest.fn().mockResolvedValue({ battlenetRequired: true }),
		},
		quarantineStatus: {
			findUnique: jest.fn().mockResolvedValue(options.statut ?? null),
			update: jest.fn().mockResolvedValue({}),
		},
	};
}

type Db = ReturnType<typeof makeDb>;

const delier = (
	db: Db,
	release = false,
	author: { discordUserId: string } | { appUserId: string } = { discordUserId: USER_ID },
) => unlinkBattlenet(db as never, { guildId: GUILD_ID, userId: USER_ID, author, release });

/** Donnees ecrites par l'unique appel a `battlenetAccount.update`. */
const donneesEcrites = (db: Db) => {
	const appels = db.battlenetAccount.update.mock.calls as [{ data: Record<string, unknown> }][];
	expect(appels.length).toBe(1);
	return appels[0]![0].data;
};

describe("unlinkBattlenet", () => {
	// Sans liberation, la trace reste : c'est elle qui empeche un autre compte
	// Discord de reprendre le meme compte Blizzard.
	it("laisse une trace et la fait annoncer", async () => {
		const db = makeDb();
		expect(await delier(db)).toBe("delie");

		const { unlinkedById, unlinkedByDiscordId, battletag, discordSyncedAt } = donneesEcrites(db);
		expect({ unlinkedById, unlinkedByDiscordId, battletag, discordSyncedAt }).toEqual({
			unlinkedById: null,
			unlinkedByDiscordId: USER_ID,
			battletag: null,
			discordSyncedAt: null,
		});
		expect(db.battlenetAccount.deleteMany).not.toHaveBeenCalled();
	});

	it("range un auteur du dashboard dans sa propre colonne", async () => {
		const db = makeDb();
		await delier(db, false, { appUserId: APP_USER_ID });

		const { unlinkedById, unlinkedByDiscordId } = donneesEcrites(db);
		expect({ unlinkedById, unlinkedByDiscordId }).toEqual({
			unlinkedById: APP_USER_ID,
			unlinkedByDiscordId: null,
		});
	});

	it("supprime aussi les traces quand on libere le compte", async () => {
		const db = makeDb({ lignes: [lien({ unlinkedAt: new Date() })] });
		expect(await delier(db, true)).toBe("libere");

		expect(db.battlenetAccount.deleteMany).toHaveBeenCalledWith({
			where: { userId: USER_ID },
		});
	});

	it("ne delie pas un membre sans lien actif", async () => {
		const db = makeDb({ lignes: [lien({ unlinkedAt: new Date() })] });
		expect(await delier(db)).toBe("aucun-lien");
		expect(db.battlenetAccount.update).not.toHaveBeenCalled();
	});

	it("laisse son acces a un membre deja libere", async () => {
		const db = makeDb({
			statut: { acceptedAt: new Date(), battlenetVerifiedAt: new Date(), releasedAt: null },
		});
		await delier(db);

		expect(db.quarantineStatus.update).not.toHaveBeenCalled();
	});

	// Encore en quarantaine : sans recul, il delierait puis accepterait le
	// reglement, et entrerait sans aucun lien.
	it("fait reculer l'etape d'un membre encore en quarantaine", async () => {
		const db = makeDb({
			statut: { acceptedAt: null, battlenetVerifiedAt: new Date(), releasedAt: null },
		});
		await delier(db);

		const appels = db.quarantineStatus.update.mock.calls as [{ data: unknown }][];
		expect(appels.map(([arg]) => arg.data)).toEqual([
			{ battlenetVerifiedAt: null, discordSyncedAt: null },
		]);
	});
});
