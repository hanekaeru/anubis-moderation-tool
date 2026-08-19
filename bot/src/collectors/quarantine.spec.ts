import { QuarantineStage } from "@anubis/shared";
import { appliquerRoles, lotPourEtape } from "./quarantine";

const GUILD_ID = "1534550360180396132";
const QUARANTINE_ROLE_ID = "900";

/** Position du plus haut role du bot : tout ce qui est en dessous lui obeit. */
const BOT_HIGHEST = 50;

function role(id: string, position: number, managed = false) {
	return {
		id,
		managed,
		comparePositionTo: (autre: { position: number }) => position - autre.position,
	};
}

/**
 * Membre factice. `porte` decrit ses roles actuels, `connus` ceux que le
 * serveur sait resoudre — un role configure mais supprime depuis n'apparait
 * dans aucun des deux.
 */
function member(
	porte: ReturnType<typeof role>[],
	connus: ReturnType<typeof role>[] = [],
) {
	const cacheServeur = new Map(
		[...porte, ...connus].map((entry) => [entry.id, entry]),
	);

	const set = jest.fn().mockResolvedValue(undefined);

	const faux = {
		id: "42",
		guild: {
			id: GUILD_ID,
			members: { me: { roles: { highest: { position: BOT_HIGHEST } } } },
			roles: { cache: cacheServeur, fetch: jest.fn().mockResolvedValue(null) },
		},
		roles: { cache: new Map(porte.map((entry) => [entry.id, entry])), set },
	};

	return { membre: faux as unknown as Parameters<typeof appliquerRoles>[0], set };
}

/** Lot d'une levee complete sans aucun role configure. */
const LEVEE_NUE = {
	addRoleIds: [] as string[],
	removeRoleIds: [QUARANTINE_ROLE_ID],
};

/** Roles transmis a Discord par l'unique `roles.set`, tries pour la comparaison. */
function rolesTransmis(set: jest.Mock): string[] {
	expect(set).toHaveBeenCalledTimes(1);
	return [...(set.mock.calls[0]![0] as string[])].sort();
}

beforeEach(() => {
	jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
	jest.restoreAllMocks();
});

describe("appliquerRoles", () => {
	// Le role de quarantaine part meme sans aucune liste configuree : c'est le
	// comportement d'avant le reglage, il ne doit pas avoir bouge.
	it("retire le role de quarantaine et garde le reste", async () => {
		const { membre, set } = member([
			role(GUILD_ID, 0),
			role(QUARANTINE_ROLE_ID, 5),
			role("1", 10),
		]);

		await appliquerRoles(membre, LEVEE_NUE, "test");

		expect(rolesTransmis(set)).toEqual(["1"]);
	});

	it("pose les roles a ajouter et retire ceux a retirer, en un seul appel", async () => {
		const { membre, set } = member(
			[role(GUILD_ID, 0), role(QUARANTINE_ROLE_ID, 5), role("2", 20)],
			[role("1", 10)],
		);

		await appliquerRoles(
			membre,
			{ addRoleIds: ["1"], removeRoleIds: [QUARANTINE_ROLE_ID, "2"] },
			"test",
		);

		expect(rolesTransmis(set)).toEqual(["1"]);
	});

	// `roles.set` est un appel unique : un role interdit dans le lot ferait
	// echouer la levee entiere plutot que le seul role fautif.
	it("ignore un role a ajouter que le bot ne peut pas attribuer", async () => {
		const { membre, set } = member(
			[role(GUILD_ID, 0), role(QUARANTINE_ROLE_ID, 5)],
			[
				// Au-dessus du plus haut role du bot.
				role("1", 80),
				// Role d'integration (bot, boost).
				role("2", 10, true),
				role("3", 10),
			],
		);

		await appliquerRoles(
			membre,
			{ addRoleIds: ["1", "2", "3"], removeRoleIds: [QUARANTINE_ROLE_ID] },
			"test",
		);

		expect(rolesTransmis(set)).toEqual(["3"]);
	});

	// Le laisser dans le lot, c'est n'annoncer aucun changement a Discord ; l'en
	// sortir reviendrait a demander un retrait que Discord refuserait.
	it("laisse dans le lot un role a retirer hors de portee du bot", async () => {
		const { membre, set } = member([
			role(GUILD_ID, 0),
			role(QUARANTINE_ROLE_ID, 5),
			role("1", 80),
			role("2", 10),
		]);

		await appliquerRoles(
			membre,
			{ addRoleIds: [], removeRoleIds: [QUARANTINE_ROLE_ID, "1", "2"] },
			"test",
		);

		expect(rolesTransmis(set)).toEqual(["1"]);
	});

	// `@everyone` porte l'identifiant du serveur et n'est jamais transmis :
	// Discord refuse qu'on cherche a l'attribuer.
	it("ne transmet jamais @everyone", async () => {
		const { membre, set } = member([role(GUILD_ID, 0), role("1", 10)]);

		await appliquerRoles(membre, LEVEE_NUE, "test");

		expect(rolesTransmis(set)).not.toContain(GUILD_ID);
	});

	// Un reglage contradictoire ne doit pas dependre de l'ordre des boucles.
	it("fait primer le retrait quand un role est dans les deux listes", async () => {
		const { membre, set } = member([
			role(GUILD_ID, 0),
			role(QUARANTINE_ROLE_ID, 5),
			role("1", 10),
		]);

		await appliquerRoles(
			membre,
			{ addRoleIds: ["1"], removeRoleIds: [QUARANTINE_ROLE_ID, "1"] },
			"test",
		);

		expect(rolesTransmis(set)).toEqual([]);
	});

	// Le role configure a pu etre supprime du serveur depuis : la levee doit
	// aboutir malgre tout, sinon le membre reste bloque sans recours.
	it("ignore un role a ajouter devenu introuvable", async () => {
		const { membre, set } = member([role(GUILD_ID, 0), role(QUARANTINE_ROLE_ID, 5)]);

		await appliquerRoles(
			membre,
			{ addRoleIds: ["404"], removeRoleIds: [QUARANTINE_ROLE_ID] },
			"test",
		);

		expect(rolesTransmis(set)).toEqual([]);
	});
});

describe("lotPourEtape", () => {
	const CONFIG = {
		roleId: QUARANTINE_ROLE_ID,
		battlenetRequired: true,
		releaseAddRoleIds: ["membre"],
		releaseRemoveRoleIds: ["arrivant"],
		acceptAddRoleIds: ["a-verifier"],
		acceptRemoveRoleIds: [],
		verifyAddRoleIds: ["verifie"],
		verifyRemoveRoleIds: [],
	};

	// Le role de quarantaine est ce qui ferme le serveur : le retirer avant la
	// derniere etape reviendrait a n'avoir aucune seconde etape.
	it("ne retire le role de quarantaine qu'a la levee complete", () => {
		expect(
			lotPourEtape(CONFIG, QuarantineStage.ACCEPTED_ONLY).removeRoleIds,
		).not.toContain(QUARANTINE_ROLE_ID);

		expect(
			lotPourEtape(CONFIG, QuarantineStage.VERIFIED_ONLY).removeRoleIds,
		).not.toContain(QUARANTINE_ROLE_ID);

		expect(
			lotPourEtape(CONFIG, QuarantineStage.CLEARED).removeRoleIds,
		).toContain(QUARANTINE_ROLE_ID);
	});

	it("donne a chaque etape son propre jeu de roles", () => {
		expect(lotPourEtape(CONFIG, QuarantineStage.ACCEPTED_ONLY).addRoleIds).toEqual(
			["a-verifier"],
		);
		expect(lotPourEtape(CONFIG, QuarantineStage.VERIFIED_ONLY).addRoleIds).toEqual(
			["verifie"],
		);
		expect(lotPourEtape(CONFIG, QuarantineStage.CLEARED).addRoleIds).toEqual([
			"membre",
		]);
	});

	// Les roles intermediaires decrivent une etape en cours : les laisser ferait
	// cohabiter « en attente de vérification » et l'acces complet sur la meme
	// fiche.
	it("nettoie les roles intermediaires a la levee complete", () => {
		const { removeRoleIds } = lotPourEtape(CONFIG, QuarantineStage.CLEARED);

		expect(removeRoleIds).toEqual(
			expect.arrayContaining(["a-verifier", "verifie", "arrivant"]),
		);
	});

	it("ne touche a rien tant qu'aucune etape n'est franchie", () => {
		expect(lotPourEtape(CONFIG, QuarantineStage.PENDING)).toEqual({
			addRoleIds: [],
			removeRoleIds: [],
		});
	});
});
