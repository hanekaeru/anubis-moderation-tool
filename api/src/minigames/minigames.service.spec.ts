import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Permission } from "@anubis/shared";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { MinigamesService } from "./minigames.service";

const GUILD_ID = "1534550360180396132";

const STAFF = {
	id: "00000000-0000-0000-0000-000000000001",
	permissions: [Permission.MINIGAMES_READ, Permission.MINIGAMES_WRITE],
} as unknown as AuthenticatedUser;

const ADMIN = {
	id: "00000000-0000-0000-0000-000000000002",
	permissions: [Permission.MINIGAMES_READ, Permission.MINIGAMES_WRITE, Permission.MINIGAMES_MANAGE],
} as unknown as AuthenticatedUser;

/** 15 janvier 2027, 23 h 30 a Paris. */
const VEILLE = new Date("2027-01-15T22:30:00Z");
/** 16 janvier 2027, 00 h 10 a Paris. */
const JOUR_J = new Date("2027-01-15T23:10:00Z");

function eventRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "11111111-1111-1111-1111-111111111111",
		guildId: GUILD_ID,
		day: new Date("2027-01-16T00:00:00Z"),
		type: "GUESS_MAP",
		title: "Devine la map",
		description: null,
		color: 0x5865f2,
		pingEnabled: true,
		pingRoleId: null,
		maxAttempts: null,
		outOfAttemptsMessage: null,
		answerHeroKey: null,
		answerMapKey: "dorado",
		answerSkin: null,
		answerTrue: null,
		pollQuestion: null,
		pollAnswers: [],
		channelId: null,
		messageId: null,
		pollMessageId: null,
		pingMessageId: null,
		endMessageId: null,
		publishedAt: null,
		discordSyncedAt: null,
		pingedAt: null,
		closedAt: null,
		lastError: null,
		createdAt: new Date("2027-01-10T10:00:00Z"),
		updatedAt: new Date("2027-01-10T10:00:00Z"),
		images: [],
		_count: { games: 0 },
		...overrides,
	};
}

function makeService(options: { event?: ReturnType<typeof eventRow> | null } = {}) {
	const event = options.event === undefined ? eventRow() : options.event;
	const prisma = {
		minigameEvent: {
			findFirst: jest.fn().mockResolvedValue(event),
			findUnique: jest.fn().mockResolvedValue(null),
			create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...eventRow(data), id: event?.id ?? "x" })),
			update: jest.fn().mockResolvedValue(event),
			delete: jest.fn().mockResolvedValue(event),
		},
		minigameGame: { groupBy: jest.fn().mockResolvedValue([]) },
		minigameMap: {
			findUnique: jest.fn().mockImplementation(({ where }) =>
				Promise.resolve(where.key === "dorado" ? { key: "dorado", name: "Dorado", enabled: true } : null),
			),
		},
		owdleHero: {
			findUnique: jest.fn().mockImplementation(({ where }) =>
				Promise.resolve(where.key === "junkrat" ? { key: "junkrat", name: "Chacal", enabled: true } : null),
			),
		},
	} as unknown as PrismaService;

	const guild = { guildId: GUILD_ID } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
	return { service: new MinigamesService(prisma, guild, audit), prisma };
}

describe("MinigamesService — verrou de la veille", () => {
	it("laisse le staff modifier le jeu du lendemain jusqu'a 23:59", async () => {
		const { service, prisma } = makeService();
		await service.updateEvent(eventRow().id, { title: "Nouveau titre" }, STAFF, VEILLE);
		expect(prisma.minigameEvent.update).toHaveBeenCalled();
	});

	it("refuse au staff le jeu du jour une fois minuit passe", async () => {
		const { service, prisma } = makeService();
		await expect(service.updateEvent(eventRow().id, { title: "Trop tard" }, STAFF, JOUR_J)).rejects.toBeInstanceOf(
			ForbiddenException,
		);
		expect(prisma.minigameEvent.update).not.toHaveBeenCalled();
	});

	it("laisse un administrateur corriger un jeu verrouille", async () => {
		const { service, prisma } = makeService();
		await service.updateEvent(eventRow().id, { title: "Correction" }, ADMIN, JOUR_J);
		expect(prisma.minigameEvent.update).toHaveBeenCalled();
	});

	it("refuse la suppression d'un jeu verrouille au staff", async () => {
		const { service } = makeService();
		await expect(service.removeEvent(eventRow().id, STAFF, JOUR_J)).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("refuse de creer un jeu pour un jour passe, meme a un administrateur", async () => {
		const { service } = makeService();
		await expect(
			service.createEvent({ day: "2027-01-14", type: "CLIP", title: "Clip" }, ADMIN, VEILLE),
		).rejects.toBeInstanceOf(BadRequestException);
	});
});

describe("MinigamesService — jeu publiable", () => {
	it("refuse un devine la map sans map", async () => {
		const { service } = makeService();
		await expect(
			service.createEvent({ day: "2027-01-20", type: "GUESS_MAP", title: "Où ?" }, STAFF, VEILLE),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("refuse un heros inconnu", async () => {
		const { service } = makeService();
		await expect(
			service.createEvent(
				{ day: "2027-01-20", type: "GUESS_HERO", title: "Qui ?", answerHeroKey: "inconnu" },
				STAFF,
				VEILLE,
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("efface les reponses etrangeres au type", async () => {
		const { service, prisma } = makeService();
		await service.createEvent(
			{ day: "2027-01-20", type: "CLIP", title: "Clip", answerMapKey: "dorado", answerTrue: true },
			STAFF,
			VEILLE,
		);
		const data = (prisma.minigameEvent.create as jest.Mock).mock.calls[0][0].data;
		expect(data.answerMapKey).toBeNull();
		expect(data.answerTrue).toBeNull();
	});

	it("refuse un deuxieme jeu le meme jour", async () => {
		const { service, prisma } = makeService();
		(prisma.minigameEvent.findUnique as jest.Mock).mockResolvedValue(eventRow());
		await expect(
			service.createEvent({ day: "2027-01-16", type: "CLIP", title: "Clip" }, STAFF, VEILLE),
		).rejects.toBeInstanceOf(ConflictException);
	});
});

describe("MinigamesService — jeu publie", () => {
	it("remet l'embed en file de correction", async () => {
		const publie = eventRow({ publishedAt: new Date("2027-01-15T23:00:05Z"), discordSyncedAt: new Date() });
		const { service, prisma } = makeService({ event: publie });
		await service.updateEvent(publie.id, { title: "Coquille corrigée" }, ADMIN, JOUR_J);
		const data = (prisma.minigameEvent.update as jest.Mock).mock.calls[0][0].data;
		expect(data.discordSyncedAt).toBeNull();
	});

	it("refuse de changer le type apres publication", async () => {
		const publie = eventRow({ publishedAt: new Date("2027-01-15T23:00:05Z") });
		const { service } = makeService({ event: publie });
		await expect(service.updateEvent(publie.id, { type: "CLIP" }, ADMIN, JOUR_J)).rejects.toBeInstanceOf(
			BadRequestException,
		);
	});

	it("refuse de toucher au sondage apres publication", async () => {
		const duel = eventRow({
			type: "DUEL",
			answerMapKey: null,
			pollAnswers: ["Ana", "Kiriko"],
			publishedAt: new Date("2027-01-15T23:00:05Z"),
		});
		const { service } = makeService({ event: duel });
		await expect(
			service.updateEvent(duel.id, { pollAnswers: ["Ana", "Baptiste"] }, ADMIN, JOUR_J),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("refuse toute modification d'un jeu termine", async () => {
		const fini = eventRow({ closedAt: new Date() });
		const { service } = makeService({ event: fini });
		await expect(service.updateEvent(fini.id, { title: "x" }, ADMIN, JOUR_J)).rejects.toBeInstanceOf(
			ConflictException,
		);
	});
});

describe("MinigamesService — participants", () => {
	const user = (id: string, username: string) => ({ id, username, globalName: null, avatarUrl: null });
	const partie = (overrides: Record<string, unknown>) => ({
		attempts: 1,
		guesses: [],
		heroFoundAt: null,
		solvedAt: null,
		xpAwarded: 0,
		updatedAt: new Date("2027-01-16T10:00:00Z"),
		...overrides,
	});

	it("range les gagnants d'abord, dans l'ordre ou ils ont trouve, et nomme les maps", async () => {
		const { service, prisma } = makeService();
		const findMany = jest.fn().mockResolvedValue([
			partie({ user: user("3", "perdant"), attempts: 3, guesses: ["ilios", "nepal", "oasis"] }),
			partie({
				user: user("2", "second"),
				attempts: 2,
				guesses: ["ilios", "dorado"],
				solvedAt: new Date("2027-01-16T09:00:00Z"),
				xpAwarded: 40,
			}),
			partie({
				user: user("1", "premier"),
				guesses: ["dorado"],
				solvedAt: new Date("2027-01-16T08:00:00Z"),
				xpAwarded: 60,
			}),
		]);
		Object.assign(prisma.minigameGame, { findMany });
		Object.assign(prisma.minigameMap, {
			findMany: jest.fn().mockResolvedValue([
				{ key: "dorado", name: "Dorado" },
				{ key: "ilios", name: "Ilios" },
			]),
		});

		const liste = await service.participants(eventRow().id);

		expect(liste.map((p) => p.member.username)).toEqual(["premier", "second", "perdant"]);
		expect(liste[1]!.guesses).toEqual(["Ilios", "Dorado"]);
		// Une cle inconnue (map supprimee depuis) reste lisible telle quelle.
		expect(liste[2]!.guesses).toEqual(["Ilios", "nepal", "oasis"]);
		// Les lignes sans essai ne sont pas des participations.
		expect(findMany.mock.calls[0][0].where).toEqual({ eventId: eventRow().id, attempts: { gt: 0 } });
	});
});
