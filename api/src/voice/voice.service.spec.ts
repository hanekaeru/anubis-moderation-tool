import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { PrismaService } from "../prisma/prisma.service";
import { VoiceService } from "./voice.service";

// const GUILD_ID = "1534867404755177634";
const GUILD_ID = "1534550360180396132";

function session(
	channelId: string,
	userId: string,
	minutesAgo: number,
	channelName = "Salon",
) {
	return {
		channelId,
		userId,
		joinedAt: new Date(Date.now() - minutesAgo * 60_000),
		user: { username: userId, globalName: null, avatarUrl: null },
		channel: { name: channelName },
	};
}

function makeService(
	sessions: unknown[] = [],
	temporaires: unknown[] = [],
	ouverts = 0,
) {
	const prisma = {
		voiceSession: { findMany: jest.fn().mockResolvedValue(sessions) },
		temporaryVoiceChannel: {
			findMany: jest.fn().mockResolvedValue(temporaires),
			count: jest.fn().mockResolvedValue(ouverts),
		},
		voiceHub: {
			findMany: jest.fn().mockResolvedValue([]),
			findFirst: jest.fn().mockResolvedValue({
				id: "hub-1",
				guildId: GUILD_ID,
				channelId: "salon-hub",
				name: "Partie Rapide (5v5)",
				namePattern: "{name} #{index}",
				userLimit: 10,
				position: 0,
				enabled: true,
				updatedAt: new Date(),
			}),
			create: jest.fn(),
			update: jest.fn(),
			delete: jest.fn().mockResolvedValue(undefined),
		},
	} as unknown as PrismaService;

	const guild = { guildId: GUILD_ID } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return new VoiceService(prisma, guild, audit);
}

const ACTOR = { id: "00000000-0000-0000-0000-000000000001" } as never;

describe("VoiceService.deleteHub", () => {
	it("refuse la suppression tant que des salons issus du hub sont ouverts", async () => {
		// Sans ce garde-fou, la cascade effacerait leurs lignes : le bot cesserait
		// de les reconnaitre et ne les supprimerait jamais une fois vides.
		await expect(makeService([], [], 2).deleteHub("hub-1", ACTOR)).rejects.toThrow(
			/encore ouverts/,
		);
	});

	it("supprime le hub quand plus aucun salon n'en depend", async () => {
		const resultat = await makeService([], [], 0).deleteHub("hub-1", ACTOR);

		// L'appelant a besoin de savoir qu'un salon Discord subsiste : c'est
		// `/delete_parties` qui l'efface, pas cette suppression.
		expect(resultat).toEqual({ channelId: "salon-hub" });
	});
});

describe("VoiceService.getLive", () => {
	it("ne renvoie rien quand personne n'est en vocal", async () => {
		const live = await makeService().getLive();

		expect(live.channels).toEqual([]);
		expect(live.totalOccupants).toBe(0);
		expect(live.temporaryChannels).toBe(0);
	});

	it("regroupe les sessions ouvertes par salon et compte les occupants", async () => {
		const live = await makeService([
			session("salon-a", "user-1", 10, "Général"),
			session("salon-a", "user-2", 5, "Général"),
			session("salon-b", "user-3", 2, "Musique"),
		]).getLive();

		expect(live.totalOccupants).toBe(3);
		// Le plus peuple en tete : c'est la que se voit un probleme.
		expect(live.channels[0]).toMatchObject({
			channelId: "salon-a",
			name: "Général",
			occupantCount: 2,
			temporary: false,
		});
		expect(live.channels[1]).toMatchObject({ channelId: "salon-b", occupantCount: 1 });
	});

	it("marque le proprietaire et le salon de creation d'origine", async () => {
		const createdAt = new Date(Date.now() - 900_000);
		const live = await makeService(
			[
				session("salon-temp", "user-owner", 15),
				session("salon-temp", "user-invite", 3),
			],
			[
				{
					channelId: "salon-temp",
					name: "Partie Rapide (5v5) #1",
					ownerId: "user-owner",
					locked: true,
					createdAt,
					hub: { name: "Partie Rapide (5v5)" },
				},
			],
		).getLive();

		const salon = live.channels[0];
		expect(salon).toMatchObject({
			temporary: true,
			locked: true,
			hubName: "Partie Rapide (5v5)",
			name: "Partie Rapide (5v5) #1",
		});
		// La date affichee est celle de l'ouverture du salon, pas de la premiere
		// arrivee : le salon existe avant que quiconque n'y soit deplace.
		expect(salon?.since).toBe(createdAt.toISOString());
		expect(salon?.occupants.find((o) => o.userId === "user-owner")?.owner).toBe(true);
		expect(salon?.occupants.find((o) => o.userId === "user-invite")?.owner).toBe(false);
		expect(live.temporaryChannels).toBe(1);
	});

	it("compte un salon temporaire vide comme ouvert sans l'afficher", async () => {
		// Une session encore ouverte est la seule preuve d'occupation : un salon
		// sans occupant n'a rien a montrer, mais reste ouvert cote bot.
		const live = await makeService(
			[],
			[
				{
					channelId: "salon-temp",
					name: "Partie #1",
					ownerId: "user-owner",
					locked: false,
					createdAt: new Date(),
					hub: { name: "Partie" },
				},
			],
		).getLive();

		expect(live.channels).toEqual([]);
		expect(live.temporaryChannels).toBe(1);
	});
});
