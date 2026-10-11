import { PermissionFlagsBits } from "discord.js";

const prismaMock = {
	voiceConfig: { findUnique: jest.fn().mockResolvedValue(null) },
};

jest.mock("../prisma", () => ({ __esModule: true, default: prismaMock }));

import * as voiceConfig from "./voiceConfig";

/**
 * Qui un proprietaire de salon temporaire ne peut pas expulser.
 *
 * Le point sensible est le **defaut** : tant que personne n'a rempli la liste
 * du dashboard, la protection doit deja tenir. Sinon le bouton « Expulser »
 * laisse sortir un moderateur de son propre salon des le premier jour.
 */

const GUILD_ID = "guild-1";

function membre(options: { modere?: boolean; roles?: string[] } = {}) {
	return {
		guild: { id: GUILD_ID },
		permissions: {
			has: (flag: bigint) =>
				flag === PermissionFlagsBits.ModerateMembers && options.modere === true,
		},
		roles: { cache: { has: (id: string) => (options.roles ?? []).includes(id) } },
	} as never;
}

beforeEach(() => {
	jest.clearAllMocks();
	voiceConfig.oublierReglages(GUILD_ID);
	prismaMock.voiceConfig.findUnique.mockResolvedValue(null);
});

describe("estProtege", () => {
	it("protege un porteur de ModerateMembers sans aucun reglage", async () => {
		expect(await voiceConfig.estProtege(membre({ modere: true }))).toBe(true);
		// La liste n'a meme pas ete lue : la permission suffit.
		expect(prismaMock.voiceConfig.findUnique).not.toHaveBeenCalled();
	});

	it("ne protege pas un membre ordinaire", async () => {
		expect(await voiceConfig.estProtege(membre())).toBe(false);
	});

	it("protege un role declare, sans pouvoir de moderation", async () => {
		prismaMock.voiceConfig.findUnique.mockResolvedValue({
			protectedRoleIds: ["role-invite"],
		});

		expect(await voiceConfig.estProtege(membre({ roles: ["role-invite"] }))).toBe(true);
		expect(await voiceConfig.estProtege(membre({ roles: ["role-autre"] }))).toBe(false);
	});

	// Meme cache de 30s que l'automod : une liste lue a chaque ouverture du
	// select ferait une requete par clic.
	it("ne relit pas la base a chaque appel", async () => {
		prismaMock.voiceConfig.findUnique.mockResolvedValue({ protectedRoleIds: [] });

		await voiceConfig.estProtege(membre());
		await voiceConfig.estProtege(membre());

		expect(prismaMock.voiceConfig.findUnique).toHaveBeenCalledTimes(1);
	});

	it("relit la base apres invalidation du cache", async () => {
		prismaMock.voiceConfig.findUnique.mockResolvedValue({ protectedRoleIds: [] });

		await voiceConfig.estProtege(membre());
		voiceConfig.oublierReglages(GUILD_ID);
		await voiceConfig.estProtege(membre());

		expect(prismaMock.voiceConfig.findUnique).toHaveBeenCalledTimes(2);
	});
});
