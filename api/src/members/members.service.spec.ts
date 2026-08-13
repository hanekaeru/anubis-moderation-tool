import { NotFoundException } from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { MembersService } from "./members.service";

const USER_ID = "250902879667879937";

const ACTOR: AuthenticatedUser = {
	id: "app-1",
	username: "admin",
	displayName: "Admin",
	role: "ADMIN",
	permissions: [],
	mustChangePassword: false,
};

function zeroCounters() {
	return {
		warning: { count: jest.fn().mockResolvedValue(0) },
		sanction: { count: jest.fn().mockResolvedValue(0) },
		memberNote: { count: jest.fn().mockResolvedValue(0) },
		ticket: { count: jest.fn().mockResolvedValue(0) },
		messageStat: { aggregate: jest.fn().mockResolvedValue({ _sum: { messageCount: null } }) },
		voiceSession: { aggregate: jest.fn().mockResolvedValue({ _sum: { durationSeconds: null } }) },
	};
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
	const counters = zeroCounters();
	const prisma = {
		member: {
			findUnique: jest.fn().mockResolvedValue(null),
		},
		memberRole: { findMany: jest.fn().mockResolvedValue([]) },
		userLevel: { findUnique: jest.fn().mockResolvedValue(null) },
		role: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
		...counters,
		...prismaOverrides,
	} as unknown as PrismaService;

	const guild = { guildId: "guild-1" } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return { service: new MembersService(prisma, guild, audit), prisma, audit };
}

describe("MembersService.findOne", () => {
	it("rejette un membre introuvable sur ce serveur", async () => {
		const { service } = makeService();
		await expect(service.findOne(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
	});

	it("convertit l'xp (BigInt) en number et mappe les compteurs", async () => {
		const { service } = makeService({
			member: {
				findUnique: jest.fn().mockResolvedValue({
					userId: USER_ID,
					nickname: null,
					status: "ACTIVE",
					joinedAt: new Date("2026-01-01T00:00:00.000Z"),
					leftAt: null,
					joinCount: 1,
					boostingSince: null,
					user: {
						username: "hanekaeru",
						globalName: "Haneka",
						avatarHash: null,
						isBot: false,
						accountCreatedAt: new Date("2020-01-01T00:00:00.000Z"),
					},
				}),
			},
			userLevel: { findUnique: jest.fn().mockResolvedValue({ xp: 12345n }) },
			warning: { count: jest.fn().mockResolvedValue(2) },
		});

		const detail = await service.findOne(USER_ID);

		expect(detail.xp).toBe(12345);
		expect(typeof detail.xp).toBe("number");
		expect(detail.counters.warnings).toBe(2);
		expect(detail.accountCreatedAt).toBe("2020-01-01T00:00:00.000Z");
	});

	it("deduit accountCreatedAt du snowflake quand la date n'est pas enregistree", async () => {
		const { service } = makeService({
			member: {
				findUnique: jest.fn().mockResolvedValue({
					userId: USER_ID,
					nickname: null,
					status: "ACTIVE",
					joinedAt: null,
					leftAt: null,
					joinCount: 0,
					boostingSince: null,
					user: {
						username: "hanekaeru",
						globalName: null,
						avatarHash: null,
						isBot: false,
						accountCreatedAt: null,
					},
				}),
			},
		});

		const detail = await service.findOne(USER_ID);
		expect(detail.accountCreatedAt).toBe("2016-11-23T08:38:28.062Z");
	});

	it("exclut les roles supprimes et trie par position decroissante", async () => {
		const { service } = makeService({
			member: {
				findUnique: jest.fn().mockResolvedValue({
					userId: USER_ID,
					nickname: null,
					status: "ACTIVE",
					joinedAt: null,
					leftAt: null,
					joinCount: 0,
					boostingSince: null,
					user: {
						username: "hanekaeru",
						globalName: null,
						avatarHash: null,
						isBot: false,
						accountCreatedAt: new Date(),
					},
				}),
			},
			memberRole: {
				findMany: jest.fn().mockResolvedValue([
					{
						userId: USER_ID,
						role: {
							id: "low",
							name: "Low",
							color: 0,
							position: 1,
							managed: false,
							trackHistory: true,
							deletedAt: null,
						},
					},
					{
						userId: USER_ID,
						role: {
							id: "gone",
							name: "Gone",
							color: 0,
							position: 99,
							managed: false,
							trackHistory: true,
							deletedAt: new Date(),
						},
					},
					{
						userId: USER_ID,
						role: {
							id: "high",
							name: "High",
							color: 0,
							position: 10,
							managed: false,
							trackHistory: true,
							deletedAt: null,
						},
					},
				]),
			},
		});

		const detail = await service.findOne(USER_ID);
		expect(detail.roles.map((r) => r.id)).toEqual(["high", "low"]);
	});
});

describe("MembersService.setRoleTracking", () => {
	it("rejette un role introuvable sur ce serveur", async () => {
		const { service } = makeService({
			role: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn(), update: jest.fn() },
		});

		await expect(
			service.setRoleTracking("role-1", true, ACTOR),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it("bascule le suivi et ecrit l'audit avant/apres", async () => {
		const update = jest.fn().mockResolvedValue({
			id: "role-1",
			name: "Staff",
			color: 0,
			position: 5,
			managed: false,
			trackHistory: false,
		});
		const { service, audit } = makeService({
			role: {
				findFirst: jest.fn().mockResolvedValue({
					id: "role-1",
					name: "Staff",
					trackHistory: true,
				}),
				findMany: jest.fn(),
				update,
			},
		});

		const result = await service.setRoleTracking("role-1", false, ACTOR);

		expect(update).toHaveBeenCalledWith({
			where: { id: "role-1" },
			data: { trackHistory: false },
		});
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "role.tracking",
				before: { trackHistory: true },
				after: { trackHistory: false, name: "Staff" },
			}),
		);
		expect(result.trackHistory).toBe(false);
	});
});

describe("MembersService.listRoles", () => {
	it("mappe les roles non supprimes en RoleSummary", async () => {
		const { service } = makeService({
			role: {
				findFirst: jest.fn(),
				update: jest.fn(),
				findMany: jest.fn().mockResolvedValue([
					{ id: "a", name: "A", color: 0, position: 2, managed: false, trackHistory: true },
				]),
			},
		});

		const roles = await service.listRoles();
		expect(roles).toEqual([
			{ id: "a", name: "A", color: 0, position: 2, managed: false, trackHistory: true },
		]);
	});
});
