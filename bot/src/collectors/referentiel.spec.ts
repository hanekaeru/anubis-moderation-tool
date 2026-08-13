import { Collection, type Guild, type GuildMember, type Role, type User } from "discord.js";

const prismaMock = {
	guild: { upsert: jest.fn().mockResolvedValue(undefined) },
	discordUser: { upsert: jest.fn().mockResolvedValue(undefined) },
	role: {
		upsert: jest.fn().mockResolvedValue(undefined),
		findMany: jest.fn().mockResolvedValue([]),
	},
	member: { upsert: jest.fn().mockResolvedValue(undefined) },
	memberRole: {
		findMany: jest.fn().mockResolvedValue([]),
		createMany: jest.fn().mockResolvedValue(undefined),
		deleteMany: jest.fn().mockResolvedValue(undefined),
	},
	memberRoleEvent: { createMany: jest.fn().mockResolvedValue(undefined) },
	identityEvent: { create: jest.fn().mockResolvedValue(undefined) },
};

jest.mock("../prisma", () => ({ __esModule: true, default: prismaMock }));

import * as referentiel from "./referentiel";

beforeEach(() => {
	jest.clearAllMocks();
});

describe("upsertRole", () => {
	it("n'ecrit jamais trackHistory : c'est un reglage du dashboard, pas une donnee Discord", async () => {
		const role = {
			id: "role-1",
			name: "Staff",
			color: 0,
			position: 3,
			managed: false,
			guild: { id: "guild-1" },
		} as unknown as Role;

		await referentiel.upsertRole(role);

		const [call] = prismaMock.role.upsert.mock.calls;
		expect(call[0].update).not.toHaveProperty("trackHistory");
		expect(call[0].create).not.toHaveProperty("trackHistory");
	});
});

describe("synchroniserRoles", () => {
	it("calcule les roles ajoutes et retires par diff avec l'etat en base, en ignorant @everyone", async () => {
		const guildId = "guild-1";
		prismaMock.memberRole.findMany.mockResolvedValueOnce([
			{ roleId: "old-role" },
			{ roleId: "kept-role" },
		]);

		const member = {
			id: "member-1",
			guild: { id: guildId },
			roles: {
				cache: new Collection([
					[guildId, { id: guildId }],
					["kept-role", { id: "kept-role" }],
					["new-role", { id: "new-role" }],
				]),
			},
		} as unknown as GuildMember;

		const result = await referentiel.synchroniserRoles(member);

		expect(result.ajoutes).toEqual(["new-role"]);
		expect(result.retires).toEqual(["old-role"]);
		expect(prismaMock.memberRole.createMany).toHaveBeenCalledWith({
			data: [{ guildId, userId: "member-1", roleId: "new-role" }],
			skipDuplicates: true,
		});
		expect(prismaMock.memberRole.deleteMany).toHaveBeenCalledWith({
			where: { guildId, userId: "member-1", roleId: { in: ["old-role"] } },
		});
	});

	it("n'ecrit rien si rien n'a change", async () => {
		prismaMock.memberRole.findMany.mockResolvedValueOnce([{ roleId: "kept-role" }]);
		const guildId = "guild-1";
		const member = {
			id: "member-1",
			guild: { id: guildId },
			roles: { cache: new Collection([["kept-role", { id: "kept-role" }]]) },
		} as unknown as GuildMember;

		await referentiel.synchroniserRoles(member);

		expect(prismaMock.memberRole.createMany).not.toHaveBeenCalled();
		expect(prismaMock.memberRole.deleteMany).not.toHaveBeenCalled();
	});
});

describe("enregistrerEvenementsRoles", () => {
	it("n'ecrit rien si aucun role n'est concerne", async () => {
		await referentiel.enregistrerEvenementsRoles("guild-1", "user-1", [], []);
		expect(prismaMock.role.findMany).not.toHaveBeenCalled();
		expect(prismaMock.memberRoleEvent.createMany).not.toHaveBeenCalled();
	});

	it("filtre les roles trackHistory=false, des deux cotes (ajout et retrait)", async () => {
		prismaMock.role.findMany.mockResolvedValueOnce([{ id: "decoratif" }]);

		await referentiel.enregistrerEvenementsRoles(
			"guild-1",
			"user-1",
			["decoratif", "important"],
			["decoratif-2"],
		);

		expect(prismaMock.memberRoleEvent.createMany).toHaveBeenCalledWith({
			data: [
				{
					guildId: "guild-1",
					userId: "user-1",
					roleId: "important",
					type: "ADDED",
					actorId: null,
				},
				{
					guildId: "guild-1",
					userId: "user-1",
					roleId: "decoratif-2",
					type: "REMOVED",
					actorId: null,
				},
			],
		});
	});

	it("traite un role absent de la table comme suivi par defaut", async () => {
		prismaMock.role.findMany.mockResolvedValueOnce([]);

		await referentiel.enregistrerEvenementsRoles("guild-1", "user-1", ["inconnu"], []);

		expect(prismaMock.memberRoleEvent.createMany).toHaveBeenCalledWith({
			data: [
				{
					guildId: "guild-1",
					userId: "user-1",
					roleId: "inconnu",
					type: "ADDED",
					actorId: null,
				},
			],
		});
	});
});

describe("enregistrerEvenementIdentite", () => {
	it("ne fait rien si l'ancienne et la nouvelle valeur sont identiques", async () => {
		await referentiel.enregistrerEvenementIdentite(
			"guild-1",
			"user-1",
			"USERNAME_CHANGED",
			"meme",
			"meme",
		);
		expect(prismaMock.identityEvent.create).not.toHaveBeenCalled();
	});

	it("enregistre le changement quand les valeurs different", async () => {
		await referentiel.enregistrerEvenementIdentite(
			"guild-1",
			"user-1",
			"USERNAME_CHANGED",
			"ancien",
			"nouveau",
		);
		expect(prismaMock.identityEvent.create).toHaveBeenCalledWith({
			data: {
				guildId: "guild-1",
				userId: "user-1",
				type: "USERNAME_CHANGED",
				oldValue: "ancien",
				newValue: "nouveau",
			},
		});
	});
});

describe("garantirContexte", () => {
	function fakeGuild(id: string): Guild {
		return { id, name: "Guild", iconURL: () => null } as unknown as Guild;
	}
	function fakeUser(id: string): User {
		return {
			id,
			username: "user",
			globalName: null,
			discriminator: "0",
			avatar: null,
			bot: false,
			createdAt: new Date(),
		} as unknown as User;
	}

	it("met en cache : un deuxieme appel avec la meme cle ne reinvoque pas guild.upsert", async () => {
		const guild = fakeGuild("guild-cache-test");
		const user = fakeUser("user-cache-test");

		const first = await referentiel.garantirContexte(guild, user);
		const upsertsAfterFirst = prismaMock.guild.upsert.mock.calls.length;
		const second = await referentiel.garantirContexte(guild, user);

		expect(first).toBe(true);
		expect(second).toBe(true);
		expect(prismaMock.guild.upsert.mock.calls.length).toBe(upsertsAfterFirst);
	});

	it("renvoie false sans jeter quand Prisma echoue", async () => {
		prismaMock.guild.upsert.mockRejectedValueOnce(new Error("DB down"));
		const guild = fakeGuild("guild-failure-test");
		const user = fakeUser("user-failure-test");

		await expect(referentiel.garantirContexte(guild, user)).resolves.toBe(false);
	});
});
