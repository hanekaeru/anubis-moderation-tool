import { partitionRoles } from "./shadowbanRole";

const GUILD_ID = "1534550360180396132";
const SHADOWBAN_ROLE_ID = "900";

/** Position du plus haut role du bot : tout ce qui est en dessous lui obeit. */
const BOT_HIGHEST = 50;

function role(id: string, position: number, managed = false) {
	return {
		id,
		managed,
		comparePositionTo: (autre: { position: number }) => position - autre.position,
	};
}

function member(roles: ReturnType<typeof role>[]) {
	return {
		id: "42",
		guild: {
			id: GUILD_ID,
			members: { me: { roles: { highest: { position: BOT_HIGHEST } } } },
		},
		roles: { cache: new Map(roles.map((entry) => [entry.id, entry])) },
	} as unknown as Parameters<typeof partitionRoles>[0];
}

describe("partitionRoles", () => {
	it("retire les roles ordinaires places sous le bot", () => {
		const { kept, removable } = partitionRoles(
			member([role("1", 10), role("2", 20)]),
			SHADOWBAN_ROLE_ID,
		);

		expect(removable).toEqual(["1", "2"]);
		expect(kept).toEqual([]);
	});

	// Discord refuserait la modification entiere pour un seul de ces roles :
	// les garder de cote ferait echouer le shadowban au lieu de l'appliquer.
	it("laisse en place ce que le bot ne peut pas toucher", () => {
		const { kept, removable } = partitionRoles(
			member([
				role("1", 10),
				// Role d'integration (bot, boost) : ni attribuable ni retirable.
				role("2", 20, true),
				// Au-dessus du plus haut role du bot.
				role("3", 80),
			]),
			SHADOWBAN_ROLE_ID,
		);

		expect(removable).toEqual(["1"]);
		expect(kept).toEqual(["2", "3"]);
	});

	// `@everyone` porte l'identifiant du serveur et n'est jamais transmis a
	// Discord ; le role de shadowban est repose explicitement par l'appelant.
	it("ignore @everyone et le role de shadowban", () => {
		const { kept, removable } = partitionRoles(
			member([role(GUILD_ID, 0), role(SHADOWBAN_ROLE_ID, 5), role("1", 10)]),
			SHADOWBAN_ROLE_ID,
		);

		expect(removable).toEqual(["1"]);
		expect(kept).toEqual([]);
	});

	// Un role exactement a la hauteur du bot lui est deja interdit.
	it("garde un role a egalite avec le plus haut role du bot", () => {
		const { kept, removable } = partitionRoles(
			member([role("1", BOT_HIGHEST)]),
			SHADOWBAN_ROLE_ID,
		);

		expect(removable).toEqual([]);
		expect(kept).toEqual(["1"]);
	});
});
