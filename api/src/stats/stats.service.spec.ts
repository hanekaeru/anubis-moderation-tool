import type { GuildContextService } from "../common/guild-context.service";
import type { PrismaService } from "../prisma/prisma.service";
import { StatsService } from "./stats.service";

function makeService(prismaOverrides: Record<string, unknown> = {}) {
	const prisma = {
		$queryRaw: jest.fn().mockResolvedValue([]),
		member: {
			count: jest.fn().mockResolvedValue(0),
		},
		messageStat: {
			groupBy: jest.fn().mockResolvedValue([]),
			aggregate: jest.fn().mockResolvedValue({ _sum: { messageCount: null, totalCharacters: null } }),
		},
		memberActivityProfile: { findMany: jest.fn().mockResolvedValue([]) },
		voiceSession: { findMany: jest.fn().mockResolvedValue([]) },
		channel: { findMany: jest.fn().mockResolvedValue([]) },
		sanction: {
			groupBy: jest.fn().mockResolvedValue([]),
			count: jest.fn().mockResolvedValue(0),
			findMany: jest.fn().mockResolvedValue([]),
		},
		ticket: {
			groupBy: jest.fn().mockResolvedValue([]),
			count: jest.fn().mockResolvedValue(0),
		},
		moderationActivity: { groupBy: jest.fn().mockResolvedValue([]) },
		appUser: { findMany: jest.fn().mockResolvedValue([]) },
		...prismaOverrides,
	} as unknown as PrismaService;

	const guild = { guildId: "guild-1" } as unknown as GuildContextService;
	return { service: new StatsService(prisma, guild), prisma };
}

describe("StatsService.overview", () => {
	it("complete les jours sans donnee a zero quand aucune ligne n'est renvoyee", async () => {
		const { service } = makeService();
		const overview = await service.overview("7d");

		expect(overview.joinsPerDay).toHaveLength(8); // bornes incluses sur 7 jours
		expect(overview.joinsPerDay.every((point) => point.value === 0)).toBe(true);
	});

	it("determine le libelle de l'auteur d'une sanction recente par ordre de priorite", async () => {
		const rows = [
			{
				id: "s1",
				user: { id: "250902879667879937", username: "u1", globalName: null, avatarUrl: null },
				type: "KICK",
				reason: "r1",
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				createdBy: { displayName: "Admin Dashboard" },
				moderator: null,
			},
			{
				id: "s2",
				user: { id: "250902879667879937", username: "u2", globalName: null, avatarUrl: null },
				type: "KICK",
				reason: "r2",
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				createdBy: null,
				moderator: { globalName: "ModGlobal", username: "modusername" },
			},
			{
				id: "s3",
				user: { id: "250902879667879937", username: "u3", globalName: null, avatarUrl: null },
				type: "KICK",
				reason: "r3",
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				createdBy: null,
				moderator: { globalName: null, username: "modusername" },
			},
			{
				id: "s4",
				user: { id: "250902879667879937", username: "u4", globalName: null, avatarUrl: null },
				type: "KICK",
				reason: "r4",
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				createdBy: null,
				moderator: null,
			},
		];
		const { service } = makeService({
			sanction: {
				groupBy: jest.fn().mockResolvedValue([]),
				count: jest.fn().mockResolvedValue(0),
				findMany: jest.fn().mockResolvedValue(rows),
			},
		});

		const overview = await service.overview("7d");

		expect(overview.recentSanctions.map((s) => s.issuedByLabel)).toEqual([
			"Admin Dashboard",
			"ModGlobal",
			"modusername",
			"Systeme",
		]);
	});

	it("agrege le classement des moderateurs par type d'action, trie et limite a 10", async () => {
		const groupBy = jest.fn().mockResolvedValue([
			{ appUserId: "app-1", moderatorId: null, action: "warn", _count: { _all: 3 } },
			{ appUserId: "app-1", moderatorId: null, action: "sanction.kick", _count: { _all: 2 } },
			{ appUserId: "app-2", moderatorId: null, action: "ticket.close", _count: { _all: 10 } },
			{ appUserId: null, moderatorId: "discord-1", action: "note.create", _count: { _all: 1 } },
		]);
		const { service } = makeService({
			moderationActivity: { groupBy },
			appUser: {
				findMany: jest.fn().mockResolvedValue([
					{ id: "app-1", displayName: "Alice" },
					{ id: "app-2", displayName: "Bob" },
				]),
			},
		});

		const overview = await service.overview("7d");
		const leaderboard = overview.moderatorLeaderboard;

		expect(leaderboard[0]).toEqual(
			expect.objectContaining({ appUserId: "app-2", displayName: "Bob", ticketsClosed: 10, total: 10 }),
		);
		expect(leaderboard[1]).toEqual(
			expect.objectContaining({ appUserId: "app-1", displayName: "Alice", warnings: 3, sanctions: 2, total: 5 }),
		);
		expect(leaderboard[2]).toEqual(
			expect.objectContaining({ appUserId: null, displayName: "discord-1", notes: 1, total: 1 }),
		);
	});
});

describe("StatsService.memberActivity", () => {
	it("ne divise jamais par zero quand le membre n'a aucun message", async () => {
		const { service } = makeService();

		const stats = await service.memberActivity("250902879667879937", "7d");

		expect(stats.totals.messages).toBe(0);
		expect(stats.totals.activeDays).toBe(0);
		expect(stats.totals.averageMessagesPerActiveDay).toBe(0);
		expect(stats.totals.averageMessageLength).toBe(0);
	});
});
