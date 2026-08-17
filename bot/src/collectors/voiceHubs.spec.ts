import type { Guild } from "discord.js";
import type { VoiceHub } from "@anubis/shared/prisma";

const prismaMock = {
	voiceHub: {
		findFirst: jest.fn().mockResolvedValue(null),
		findMany: jest.fn().mockResolvedValue([]),
		update: jest.fn().mockResolvedValue(undefined),
		updateMany: jest.fn().mockResolvedValue(undefined),
	},
	temporaryVoiceChannel: {
		create: jest.fn(),
		findFirst: jest.fn().mockResolvedValue(null),
		findMany: jest.fn().mockResolvedValue([]),
		update: jest.fn().mockResolvedValue(undefined),
		updateMany: jest.fn().mockResolvedValue(undefined),
	},
};

const occupantsDuSalon = jest.fn().mockResolvedValue([]);

jest.mock("../prisma", () => ({ __esModule: true, default: prismaMock }));
jest.mock("./voice", () => ({ __esModule: true, occupantsDuSalon }));
jest.mock("./voiceLog", () => ({
	__esModule: true,
	salonCree: jest.fn().mockResolvedValue(undefined),
	salonSupprime: jest.fn().mockResolvedValue(undefined),
	proprieteTransferee: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./referentiel", () => ({
	__esModule: true,
	upsertUser: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/voicePanel", () => ({
	__esModule: true,
	posterPanneau: jest.fn().mockResolvedValue(undefined),
}));

import * as voiceHubs from "./voiceHubs";

const GUILD_ID = "guild-1";
const CHANNEL_ID = "salon-temp-1";
const OWNER_ID = "user-owner";

const supprimerSalon = jest.fn().mockResolvedValue(undefined);
const editerAcces = jest.fn().mockResolvedValue(undefined);
const supprimerAcces = jest.fn().mockResolvedValue(undefined);
const creerSalon = jest.fn();

const BOT_ID = "bot-1";

function salonFactice() {
	return {
		id: CHANNEL_ID,
		guild: { id: GUILD_ID, members: { me: { id: BOT_ID } }, roles: { everyone: { id: GUILD_ID } } },
		isVoiceBased: () => true,
		send: jest.fn().mockResolvedValue(undefined),
		delete: supprimerSalon,
		permissionOverwrites: { edit: editerAcces, delete: supprimerAcces },
	};
}

function serveur(salonExiste = true): Guild {
	return {
		id: GUILD_ID,
		name: "Serveur",
		members: { me: { id: BOT_ID } },
		roles: { everyone: { id: GUILD_ID } },
		client: { user: { id: BOT_ID } },
		channels: {
			fetch: jest.fn().mockResolvedValue(salonExiste ? salonFactice() : null),
			create: creerSalon,
		},
	} as unknown as Guild;
}

function ligneTemporaire(overrides: Record<string, unknown> = {}) {
	return {
		id: "temp-uuid",
		hubId: "hub-uuid",
		guildId: GUILD_ID,
		channelId: CHANNEL_ID,
		name: "Partie Rapide (5v5) #1",
		index: 1,
		ownerId: OWNER_ID,
		locked: false,
		createdAt: new Date(Date.now() - 600_000),
		closedAt: null,
		...overrides,
	};
}

// La reconciliation journalise son bilan a chaque appel : utile au demarrage
// du bot, pur bruit dans le journal de CI.
let silence: jest.SpyInstance;

beforeEach(() => {
	jest.clearAllMocks();
	silence = jest.spyOn(console, "log").mockImplementation(() => {});
	creerSalon.mockResolvedValue(salonFactice());
	occupantsDuSalon.mockResolvedValue([]);
	prismaMock.temporaryVoiceChannel.findFirst.mockResolvedValue(null);
	prismaMock.temporaryVoiceChannel.findMany.mockResolvedValue([]);
});

afterEach(() => {
	silence.mockRestore();
});

describe("formaterNom", () => {
	it("remplace {name} et {index} dans le gabarit du hub", () => {
		const hub = {
			name: "Partie Rapide (5v5)",
			namePattern: "{name} #{index}",
		} as VoiceHub;

		expect(voiceHubs.formaterNom(hub, 3)).toBe("Partie Rapide (5v5) #3");
	});

	it("tronque a la limite Discord de 100 caracteres", () => {
		const hub = {
			name: "x".repeat(150),
			namePattern: "{name} #{index}",
		} as VoiceHub;

		expect(voiceHubs.formaterNom(hub, 1)).toHaveLength(100);
	});
});

describe("verrouillage", () => {
	it("garantit l'acces du bot avant de refuser Connect a @everyone", async () => {
		// Le bug corrige : sans cet acces explicite, refuser Connect a @everyone
		// le retire aussi au bot, et Discord refuse ensuite toute modification
		// d'une permission qu'il ne possede plus — le salon restait verrouille
		// pour toujours.
		const salon = salonFactice();

		await voiceHubs.definirVerrou(salon as never, true);

		const cibles = editerAcces.mock.calls.map((appel) => appel[0]);
		expect(cibles).toEqual([BOT_ID, GUILD_ID]);
		expect(editerAcces.mock.calls[0]?.[1]).toMatchObject({ Connect: true });
		expect(editerAcces.mock.calls[1]?.[1]).toEqual({ Connect: false });
	});

	it("rend Connect neutre au deverrouillage plutot que de l'autoriser", async () => {
		// `true` ecraserait une restriction posee ailleurs — un confinement
		// anti-raid, une permission de categorie.
		const salon = salonFactice();

		await voiceHubs.definirVerrou(salon as never, false);

		expect(editerAcces.mock.calls[1]?.[1]).toEqual({ Connect: null });
		expect(prismaMock.temporaryVoiceChannel.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ data: { locked: false } }),
		);
	});
});

describe("quitterSalonTemporaire", () => {
	it("ne fait rien pour un salon qui n'est pas temporaire", async () => {
		await voiceHubs.quitterSalonTemporaire(serveur(), "salon-ordinaire", OWNER_ID);

		expect(prismaMock.temporaryVoiceChannel.update).not.toHaveBeenCalled();
		expect(supprimerSalon).not.toHaveBeenCalled();
	});

	it("supprime le salon quand le dernier occupant s'en va", async () => {
		prismaMock.temporaryVoiceChannel.findFirst.mockResolvedValue(ligneTemporaire());
		occupantsDuSalon.mockResolvedValue([]);

		await voiceHubs.quitterSalonTemporaire(serveur(), CHANNEL_ID, OWNER_ID);

		expect(supprimerSalon).toHaveBeenCalled();
		expect(prismaMock.temporaryVoiceChannel.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ closedAt: expect.any(Date) }),
			}),
		);
	});

	it("transfere la propriete au plus ancien occupant restant", async () => {
		prismaMock.temporaryVoiceChannel.findFirst.mockResolvedValue(ligneTemporaire());
		occupantsDuSalon.mockResolvedValue([
			{ userId: "user-b", joinedAt: new Date(Date.now() - 300_000) },
			{ userId: "user-c", joinedAt: new Date(Date.now() - 60_000) },
		]);

		await voiceHubs.quitterSalonTemporaire(serveur(), CHANNEL_ID, OWNER_ID);

		expect(supprimerSalon).not.toHaveBeenCalled();
		expect(prismaMock.temporaryVoiceChannel.update).toHaveBeenCalledWith(
			expect.objectContaining({ data: { ownerId: "user-b" } }),
		);
	});

	it("deplace l'acces garanti vers le nouveau proprietaire", async () => {
		// Sans ce transfert, un salon verrouille resterait ouvert au partant et
		// ferme a celui qui vient d'en heriter.
		prismaMock.temporaryVoiceChannel.findFirst.mockResolvedValue(
			ligneTemporaire({ locked: true }),
		);
		occupantsDuSalon.mockResolvedValue([
			{ userId: "user-b", joinedAt: new Date(Date.now() - 300_000) },
		]);

		await voiceHubs.quitterSalonTemporaire(serveur(), CHANNEL_ID, OWNER_ID);

		expect(supprimerAcces).toHaveBeenCalledWith(OWNER_ID);
		expect(editerAcces).toHaveBeenCalledWith("user-b", { Connect: true });
	});

	it("ne touche a rien quand ce n'est pas le proprietaire qui part", async () => {
		prismaMock.temporaryVoiceChannel.findFirst.mockResolvedValue(ligneTemporaire());
		occupantsDuSalon.mockResolvedValue([
			{ userId: OWNER_ID, joinedAt: new Date(Date.now() - 300_000) },
		]);

		await voiceHubs.quitterSalonTemporaire(serveur(), CHANNEL_ID, "user-b");

		expect(prismaMock.temporaryVoiceChannel.update).not.toHaveBeenCalled();
		expect(supprimerSalon).not.toHaveBeenCalled();
	});
});

describe("reconcilierSalons", () => {
	it("clot la ligne d'un salon disparu pendant l'arret", async () => {
		prismaMock.temporaryVoiceChannel.findMany.mockResolvedValue([ligneTemporaire()]);

		await voiceHubs.reconcilierSalons(serveur(false));

		expect(prismaMock.temporaryVoiceChannel.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { channelId: CHANNEL_ID, closedAt: null },
			}),
		);
	});

	it("supprime un salon reste ouvert mais vide", async () => {
		prismaMock.temporaryVoiceChannel.findMany.mockResolvedValue([ligneTemporaire()]);
		occupantsDuSalon.mockResolvedValue([]);

		await voiceHubs.reconcilierSalons(serveur());

		expect(supprimerSalon).toHaveBeenCalled();
	});

	it("redonne la propriete quand le proprietaire est parti pendant l'arret", async () => {
		prismaMock.temporaryVoiceChannel.findMany.mockResolvedValue([ligneTemporaire()]);
		occupantsDuSalon.mockResolvedValue([
			{ userId: "user-b", joinedAt: new Date(Date.now() - 120_000) },
		]);

		await voiceHubs.reconcilierSalons(serveur());

		expect(supprimerSalon).not.toHaveBeenCalled();
		expect(prismaMock.temporaryVoiceChannel.update).toHaveBeenCalledWith(
			expect.objectContaining({ data: { ownerId: "user-b" } }),
		);
	});

	it("laisse intact un salon dont le proprietaire est toujours la", async () => {
		prismaMock.temporaryVoiceChannel.findMany.mockResolvedValue([ligneTemporaire()]);
		occupantsDuSalon.mockResolvedValue([
			{ userId: OWNER_ID, joinedAt: new Date(Date.now() - 120_000) },
		]);

		await voiceHubs.reconcilierSalons(serveur());

		expect(prismaMock.temporaryVoiceChannel.update).not.toHaveBeenCalled();
		expect(supprimerSalon).not.toHaveBeenCalled();
	});
});

describe("oublierSalon", () => {
	it("clot le salon temporaire et libere le hub, pour que /create_parties le recree", async () => {
		await voiceHubs.oublierSalon(CHANNEL_ID);

		expect(prismaMock.temporaryVoiceChannel.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { channelId: CHANNEL_ID, closedAt: null } }),
		);
		expect(prismaMock.voiceHub.updateMany).toHaveBeenCalledWith({
			where: { channelId: CHANNEL_ID },
			data: { channelId: null },
		});
	});
});
