import type { Guild } from "discord.js";
import type { VoiceHub } from "@anubis/shared/prisma";

const prismaMock = {
	voiceHub: {
		findFirst: jest.fn().mockResolvedValue(null),
		findUnique: jest.fn().mockResolvedValue(null),
		findMany: jest.fn().mockResolvedValue([]),
		update: jest.fn().mockResolvedValue(undefined),
		updateMany: jest.fn().mockResolvedValue(undefined),
	},
	temporaryVoiceChannel: {
		create: jest.fn(),
		findFirst: jest.fn().mockResolvedValue(null),
		findUnique: jest.fn().mockResolvedValue(null),
		findMany: jest.fn().mockResolvedValue([]),
		update: jest.fn().mockResolvedValue(undefined),
		updateMany: jest.fn().mockResolvedValue(undefined),
	},
	voiceHubRank: {
		findFirst: jest.fn().mockResolvedValue(null),
		findUnique: jest.fn().mockResolvedValue(null),
		findMany: jest.fn().mockResolvedValue([]),
		update: jest.fn().mockResolvedValue(undefined),
	},
	voiceHubPlatform: {
		findFirst: jest.fn().mockResolvedValue(null),
		findMany: jest.fn().mockResolvedValue([]),
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
	salonPersonnalise: jest.fn().mockResolvedValue(undefined),
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
const deplacerSalon = jest.fn().mockResolvedValue(undefined);
const definirLimite = jest.fn().mockResolvedValue(undefined);
const poserSujet = jest.fn().mockResolvedValue(undefined);
/** Categorie renvoyee par `guild.channels.fetch` dans les tests de rangement. */
const chercherSalon = jest.fn().mockResolvedValue(null);
/** `guild.channels.create`, appele quand une categorie manque. */
const creerCategorie = jest.fn();
/** Recherche par nom dans le cache, avant toute creation. */
const chercherDansCache = jest.fn().mockReturnValue(undefined);

const BOT_ID = "bot-1";

function salonFactice(overrides: Record<string, unknown> = {}) {
	return {
		id: CHANNEL_ID,
		guild: {
			id: GUILD_ID,
			members: { me: { id: BOT_ID } },
			roles: { everyone: { id: GUILD_ID } },
			channels: {
				fetch: chercherSalon,
				create: creerCategorie,
				cache: { find: chercherDansCache },
			},
		},
		client: { rest: { put: poserSujet }, user: { id: BOT_ID } },
		parentId: null,
		userLimit: 0,
		isVoiceBased: () => true,
		send: jest.fn().mockResolvedValue(undefined),
		delete: supprimerSalon,
		setParent: deplacerSalon,
		setUserLimit: definirLimite,
		permissionOverwrites: { edit: editerAcces, delete: supprimerAcces },
		...overrides,
	};
}

/** Categorie Discord factice, avec le nombre de salons qu'elle contient. */
function categorieFactice(id: string, salons = 0, nom = `Categorie ${id}`) {
	return {
		id,
		name: nom,
		// 4 = ChannelType.GuildCategory
		type: 4,
		children: { cache: { size: salons } },
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
			cache: { find: chercherDansCache },
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
		rankId: null,
		platformId: null,
		topic: null,
		createdAt: new Date(Date.now() - 600_000),
		closedAt: null,
		// `reconcilierSalons` les charge par `include` : les omettre ici
		// testerait une forme de ligne que Prisma ne renvoie jamais.
		hub: hubFactice(),
		rank: null,
		platform: null,
		...overrides,
	};
}

function hubFactice(overrides: Record<string, unknown> = {}) {
	return {
		id: "hub-uuid",
		guildId: GUILD_ID,
		channelId: "salon-hub-1",
		name: "Partie Rapide (5v5)",
		namePattern: "{name} #{index}",
		statusPattern: "{rang} {plateforme} · {sujet}",
		placementMode: "RANK_CATEGORY",
		landingCategoryName: "En attente",
		landingCategoryId: "categorie-attente",
		userLimit: 0,
		position: 0,
		enabled: true,
		...overrides,
	};
}

function rangFactice(overrides: Record<string, unknown> = {}) {
	return {
		id: "rank-or",
		hubId: "hub-uuid",
		label: "Or",
		emoji: null,
		categoryId: "categorie-or",
		position: 0,
		...overrides,
	};
}

// La reconciliation journalise son bilan a chaque appel : utile au demarrage
// du bot, pur bruit dans le journal de CI.
let silence: jest.SpyInstance;

beforeEach(() => {
	jest.clearAllMocks();
	silence = jest.spyOn(console, "log").mockImplementation(() => {});
	creerSalon.mockImplementation(async ({ name, type }: { name: string; type: number }) =>
		type === 4 ? categorieFactice(`categorie-creee-${name}`, 0, name) : salonFactice(),
	);
	occupantsDuSalon.mockResolvedValue([]);
	prismaMock.temporaryVoiceChannel.findFirst.mockResolvedValue(null);
	prismaMock.temporaryVoiceChannel.findMany.mockResolvedValue([]);
	prismaMock.voiceHub.findUnique.mockResolvedValue(hubFactice());
	prismaMock.voiceHubRank.findFirst.mockResolvedValue(null);
	prismaMock.voiceHubPlatform.findFirst.mockResolvedValue(null);
	chercherDansCache.mockReturnValue(undefined);
	creerCategorie.mockImplementation(async ({ name }: { name: string }) =>
		categorieFactice(`categorie-creee-${name}`, 0, name),
	);
	// Par defaut, toute categorie demandee existe : les tests qui veulent
	// l'inverse la font disparaitre explicitement.
	chercherSalon.mockImplementation(async (id: string) => categorieFactice(id));
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

describe("appliquerPersonnalisation", () => {
	it("range le salon dans la categorie du rang choisi", async () => {
		const salon = salonFactice();
		prismaMock.voiceHubRank.findFirst.mockResolvedValue(rangFactice());
		chercherSalon.mockResolvedValue(categorieFactice("categorie-or"));

		const resultat = await voiceHubs.appliquerPersonnalisation(
			salon as never,
			ligneTemporaire() as never,
			{ rankId: "rank-or", platformId: null, topic: "duo", userLimit: null },
		);

		expect(deplacerSalon).toHaveBeenCalledWith(
			"categorie-or",
			expect.objectContaining({ lockPermissions: false }),
		);
		expect(resultat.avertissement).toBeNull();
	});

	// Les permissions du salon portent le verrou du panneau et l'acces garanti
	// du proprietaire : les synchroniser sur la categorie d'arrivee les
	// effacerait, et un salon verrouille se rouvrirait a chaque changement de
	// rang.
	it("ne synchronise jamais les permissions sur la categorie d'arrivee", async () => {
		const salon = salonFactice();
		prismaMock.voiceHubRank.findFirst.mockResolvedValue(rangFactice());
		chercherSalon.mockResolvedValue(categorieFactice("categorie-or"));

		await voiceHubs.appliquerPersonnalisation(
			salon as never,
			ligneTemporaire() as never,
			{ rankId: "rank-or", platformId: null, topic: null, userLimit: null },
		);

		const [, options] = deplacerSalon.mock.calls[0] as [string, { lockPermissions: boolean }];
		expect(options.lockPermissions).toBe(false);
	});

	it("refuse le rang quand la categorie est pleine et garde le precedent", async () => {
		const salon = salonFactice();
		prismaMock.voiceHubRank.findFirst.mockResolvedValue(rangFactice());
		chercherSalon.mockResolvedValue(
			categorieFactice("categorie-or", voiceHubs.MAX_CHANNELS_PER_CATEGORY),
		);

		const resultat = await voiceHubs.appliquerPersonnalisation(
			salon as never,
			ligneTemporaire() as never,
			{ rankId: "rank-or", platformId: null, topic: null, userLimit: null },
		);

		expect(deplacerSalon).not.toHaveBeenCalled();
		expect(resultat.avertissement).toContain("pleine");
		// Le rang n'est pas enregistre : sinon la base annoncerait un
		// rangement que Discord n'a jamais fait.
		expect(prismaMock.temporaryVoiceChannel.update).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ rankId: null }) }),
		);
	});

	it("renvoie le salon en attente quand le rang est retire", async () => {
		const salon = salonFactice({ parentId: "categorie-or" });

		await voiceHubs.appliquerPersonnalisation(
			salon as never,
			ligneTemporaire({ rankId: "rank-or" }) as never,
			{ rankId: null, platformId: null, topic: null, userLimit: null },
		);

		expect(deplacerSalon).toHaveBeenCalledWith(
			"categorie-attente",
			expect.objectContaining({ lockPermissions: false }),
		);
	});

	// Le staff n'a plus a creer neuf categories a la main ni a en recopier les
	// identifiants : le premier salon qui prend le rang la fait naitre.
	it("cree la categorie du rang quand elle n'existe pas encore", async () => {
		const salon = salonFactice();
		prismaMock.voiceHubRank.findFirst.mockResolvedValue(
			rangFactice({ categoryId: null }),
		);
		chercherDansCache.mockReturnValue(undefined);

		await voiceHubs.appliquerPersonnalisation(
			salon as never,
			ligneTemporaire() as never,
			{ rankId: "rank-or", platformId: null, topic: null, userLimit: null },
		);

		expect(creerCategorie).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Or" }),
		);
		// L'identifiant est retenu : la recherche et la creation ne se
		// rejouent pas au salon suivant.
		expect(prismaMock.voiceHubRank.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: { categoryId: "categorie-creee-Or" },
			}),
		);
	});

	// Une categorie faite a la main entre-temps ne doit pas etre doublee.
	it("reutilise une categorie deja nommee comme le rang", async () => {
		const salon = salonFactice();
		prismaMock.voiceHubRank.findFirst.mockResolvedValue(
			rangFactice({ categoryId: null }),
		);
		chercherDansCache.mockReturnValue(categorieFactice("categorie-or-existante"));

		await voiceHubs.appliquerPersonnalisation(
			salon as never,
			ligneTemporaire() as never,
			{ rankId: "rank-or", platformId: null, topic: null, userLimit: null },
		);

		expect(creerCategorie).not.toHaveBeenCalled();
		expect(deplacerSalon).toHaveBeenCalledWith(
			"categorie-or-existante",
			expect.objectContaining({ lockPermissions: false }),
		);
	});

	// « Partie Rapide » range tous ses salons ensemble : le rang n'y a pas de
	// sens, et le proposer donnerait un choix sans effet.
	it("ignore le rang quand le salon de creation a une categorie fixe", async () => {
		const salon = salonFactice({ parentId: "categorie-attente" });
		prismaMock.voiceHub.findUnique.mockResolvedValue(
			hubFactice({
				placementMode: "FIXED_CATEGORY",
				landingCategoryName: "Partie Rapide",
			}),
		);
		prismaMock.voiceHubRank.findFirst.mockResolvedValue(rangFactice());

		const resultat = await voiceHubs.appliquerPersonnalisation(
			salon as never,
			ligneTemporaire() as never,
			{ rankId: "rank-or", platformId: null, topic: "duo", userLimit: null },
		);

		expect(deplacerSalon).not.toHaveBeenCalled();
		expect(resultat.rank).toBeNull();
	});

	// Le nom porte le gabarit du hub et rien d'autre : Discord ne laisse le
	// changer que deux fois par dix minutes, c'est le sujet qui porte le rang.
	it("ne renomme jamais le salon", async () => {
		const renommer = jest.fn();
		const salon = salonFactice({ setName: renommer });
		prismaMock.voiceHubRank.findFirst.mockResolvedValue(rangFactice());
		chercherSalon.mockResolvedValue(categorieFactice("categorie-or"));

		await voiceHubs.appliquerPersonnalisation(
			salon as never,
			ligneTemporaire() as never,
			{ rankId: "rank-or", platformId: null, topic: "duo", userLimit: null },
		);

		expect(renommer).not.toHaveBeenCalled();
		expect(poserSujet).toHaveBeenCalledWith(
			`/channels/${CHANNEL_ID}/voice-status`,
			expect.objectContaining({ body: { status: "Or · duo" } }),
		);
	});

	// L'identifiant vient du client : un rang d'un autre salon de creation ne
	// doit pas pouvoir deplacer le salon vers une categorie qu'il ne propose
	// pas.
	it("ignore un rang qui n'appartient pas au salon de creation", async () => {
		const salon = salonFactice();
		prismaMock.voiceHubRank.findFirst.mockResolvedValue(null);

		const resultat = await voiceHubs.appliquerPersonnalisation(
			salon as never,
			ligneTemporaire() as never,
			{ rankId: "rank-etranger", platformId: null, topic: null, userLimit: null },
		);

		expect(resultat.rank).toBeNull();
		expect(deplacerSalon).toHaveBeenCalledWith(
			"categorie-attente",
			expect.anything(),
		);
		expect(deplacerSalon).not.toHaveBeenCalledWith("categorie-or", expect.anything());
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
