import { BadRequestException } from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { EsportService } from "./esport.service";

const GUILD_ID = "1534550360180396132";
const ACTOR = { id: "app-1", permissions: [] } as unknown as AuthenticatedUser;

const WEEK = {
	id: "week-1",
	guildId: GUILD_ID,
	// Lundi 12 octobre 2026.
	weekStart: new Date("2026-10-12T00:00:00Z"),
	title: null,
	description: null,
	publishRequestedAt: null as Date | null,
	channelId: null,
	messageId: null,
	publishedAt: null,
	discordSyncedAt: null,
	lastError: null,
	removalRequestedAt: null,
	createdById: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

const TEAM_A = "00000000-0000-0000-0000-0000000000aa";
const TEAM_B = "00000000-0000-0000-0000-0000000000bb";

function makeService(overrides: Record<string, unknown> = {}) {
	const prisma: Record<string, any> = {
		esportConfig: { findUnique: jest.fn().mockResolvedValue({ channelId: "1539001325478486026" }) },
		esportTeam: {
			findMany: jest.fn().mockResolvedValue([
				{ id: TEAM_A, guildId: GUILD_ID, archivedAt: null },
				{ id: TEAM_B, guildId: GUILD_ID, archivedAt: null },
			]),
			findFirst: jest.fn().mockResolvedValue({ id: TEAM_A, name: "Falcons", archivedAt: null }),
			update: jest.fn().mockResolvedValue({ id: TEAM_A, name: "Falcons", archivedAt: new Date() }),
			delete: jest.fn(),
		},
		esportWeek: {
			findFirst: jest.fn().mockResolvedValue(WEEK),
			findUniqueOrThrow: jest.fn().mockResolvedValue({ ...WEEK, matches: [] }),
			update: jest.fn(),
			updateMany: jest.fn(),
		},
		esportMatch: {
			count: jest.fn().mockResolvedValue(0),
			create: jest.fn().mockResolvedValue({ id: "match-1" }),
			findFirst: jest.fn(),
			update: jest.fn(),
		},
		...overrides,
	};
	prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));

	const guild = { guildId: GUILD_ID } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return { service: new EsportService(prisma as unknown as PrismaService, guild, audit), prisma };
}

const match = (scheduledAt: string, teamAId: string | null = TEAM_A, teamBId: string | null = TEAM_B) => ({
	teamAId,
	teamBId,
	scheduledAt,
});

describe("EsportService.addMatch", () => {
	it("accepte un match de la semaine, a l'heure de Paris", async () => {
		const { service, prisma } = makeService();

		// Dimanche 18 octobre, 23 h 30 a Paris.
		await service.addMatch("week-1", match("2026-10-18T21:30:00.000Z"), ACTOR);

		expect(prisma.esportMatch.create).toHaveBeenCalled();
	});

	// 22 h 30 UTC le dimanche, c'est deja lundi a Paris : semaine suivante.
	it("refuse un match qui tombe dans une autre semaine", async () => {
		const { service, prisma } = makeService();

		await expect(
			service.addMatch("week-1", match("2026-10-18T22:30:00.000Z"), ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(prisma.esportMatch.create).not.toHaveBeenCalled();
	});

	it("refuse une equipe contre elle-meme", async () => {
		const { service } = makeService();

		await expect(
			service.addMatch("week-1", match("2026-10-13T18:00:00.000Z", TEAM_A, TEAM_A), ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("accepte un adversaire a determiner", async () => {
		const { service, prisma } = makeService();

		await service.addMatch("week-1", match("2026-10-13T18:00:00.000Z", TEAM_A, null), ACTOR);

		expect(prisma.esportMatch.create.mock.calls[0][0].data.teamBId).toBeNull();
	});

	// Un recapitulatif deja publie doit etre corrige par le bot.
	it("remet en file une semaine deja envoyee", async () => {
		const { service, prisma } = makeService();

		await service.addMatch("week-1", match("2026-10-13T18:00:00.000Z"), ACTOR);

		expect(prisma.esportWeek.updateMany).toHaveBeenCalledWith({
			where: { id: "week-1", publishRequestedAt: { not: null }, removalRequestedAt: null },
			data: { discordSyncedAt: null },
		});
	});
});

describe("EsportService.publishWeek", () => {
	it("refuse sans salon de publication", async () => {
		const { service } = makeService({
			esportConfig: { findUnique: jest.fn().mockResolvedValue(null) },
		});

		await expect(service.publishWeek("week-1", ACTOR)).rejects.toBeInstanceOf(BadRequestException);
	});

	it("refuse une semaine sans match", async () => {
		const { service } = makeService();

		await expect(service.publishWeek("week-1", ACTOR)).rejects.toBeInstanceOf(BadRequestException);
	});

	it("met la semaine en file pour le bot", async () => {
		const { service, prisma } = makeService();
		prisma.esportMatch.count.mockResolvedValue(3);

		await service.publishWeek("week-1", ACTOR);

		expect(prisma.esportWeek.update).toHaveBeenCalledWith({
			where: { id: "week-1" },
			data: expect.objectContaining({
				publishRequestedAt: expect.any(Date),
				discordSyncedAt: null,
				lastError: null,
			}),
		});
	});
});

describe("EsportService.removeTeam", () => {
	// Les semaines passees doivent continuer d'afficher l'equipe.
	it("archive une equipe deja utilisee", async () => {
		const { service, prisma } = makeService();
		prisma.esportMatch.count.mockResolvedValue(2);

		const archived = await service.removeTeam(TEAM_A, ACTOR);

		expect(prisma.esportTeam.delete).not.toHaveBeenCalled();
		expect(archived?.archived).toBe(true);
	});

	it("supprime une equipe jamais utilisee", async () => {
		const { service, prisma } = makeService();

		expect(await service.removeTeam(TEAM_A, ACTOR)).toBeNull();
		expect(prisma.esportTeam.delete).toHaveBeenCalledWith({ where: { id: TEAM_A } });
	});
});

describe("EsportService.setResult", () => {
	it("met le resultat en file et garde la date de fin d'origine", async () => {
		const finishedAt = new Date("2026-10-13T20:00:00Z");
		const { service, prisma } = makeService();
		prisma.esportMatch.findFirst.mockResolvedValue({
			id: "match-1",
			weekId: "week-1",
			finishedAt,
			scoreA: 2,
			scoreB: 2,
			week: WEEK,
		});

		await service.setResult("match-1", { scoreA: 3, scoreB: 2, spoiler: null }, ACTOR);

		expect(prisma.esportMatch.update).toHaveBeenCalledWith({
			where: { id: "match-1" },
			data: expect.objectContaining({
				scoreA: 3,
				scoreB: 2,
				finishedAt,
				resultSyncedAt: null,
			}),
		});
	});
});
