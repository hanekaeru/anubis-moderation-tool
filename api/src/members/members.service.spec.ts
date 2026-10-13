import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import type { ModerationPointsService } from "../moderation/moderation-points.service";
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
		warning: { count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: { points: null } }) },
		sanction: { count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: { points: null } }) },
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

	const points = {
		getConfig: jest.fn().mockResolvedValue({
			warnThreshold: 6,
			criticalThreshold: 12,
		}),
	} as unknown as ModerationPointsService;

	return {
		service: new MembersService(prisma, guild, audit, points),
		prisma,
		audit,
		points,
	};
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
						avatarUrl: null,
						isBot: false,
						accountCreatedAt: new Date("2020-01-01T00:00:00.000Z"),
					},
				}),
			},
			userLevel: { findUnique: jest.fn().mockResolvedValue({ xp: 12345n }) },
			warning: { count: jest.fn().mockResolvedValue(2), aggregate: jest.fn().mockResolvedValue({ _sum: { points: null } }) },
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
						avatarUrl: null,
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
						avatarUrl: null,
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

describe("MembersService.updateRoleSettings", () => {
	const STAFF = {
		id: "role-1",
		name: "Staff",
		color: 0,
		position: 5,
		managed: false,
		trackHistory: true,
		isSeparator: false,
	};

	it("rejette un role introuvable sur ce serveur", async () => {
		const { service } = makeService({
			role: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn(), update: jest.fn() },
		});

		await expect(
			service.updateRoleSettings("role-1", { trackHistory: true }, ACTOR),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it("bascule le suivi et ecrit l'audit avant/apres", async () => {
		const update = jest.fn().mockResolvedValue({ ...STAFF, trackHistory: false });
		const { service, audit } = makeService({
			role: { findFirst: jest.fn().mockResolvedValue(STAFF), findMany: jest.fn(), update },
		});

		const result = await service.updateRoleSettings("role-1", { trackHistory: false }, ACTOR);

		// Seul le champ envoye est ecrit : basculer le suivi ne doit pas
		// retirer au passage le marquage de separateur.
		expect(update).toHaveBeenCalledWith({
			where: { id: "role-1" },
			data: { trackHistory: false },
		});
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "role.tracking",
				before: { trackHistory: true, separator: false },
				after: { trackHistory: false, separator: false, name: "Staff" },
			}),
		);
		expect(result.trackHistory).toBe(false);
	});

	it("marque un role comme separateur", async () => {
		const update = jest.fn().mockResolvedValue({ ...STAFF, isSeparator: true });
		const { service } = makeService({
			role: { findFirst: jest.fn().mockResolvedValue(STAFF), findMany: jest.fn(), update },
		});

		const result = await service.updateRoleSettings("role-1", { separator: true }, ACTOR);

		expect(update).toHaveBeenCalledWith({
			where: { id: "role-1" },
			data: { isSeparator: true },
		});
		expect(result.separator).toBe(true);
	});

	// La fiche proposerait de l'ajouter, et Discord refuserait l'attribution.
	it("refuse un role gere par une integration", async () => {
		const update = jest.fn();
		const { service } = makeService({
			role: {
				findFirst: jest.fn().mockResolvedValue({ ...STAFF, managed: true }),
				findMany: jest.fn(),
				update,
			},
		});

		await expect(
			service.updateRoleSettings("role-1", { separator: true }, ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(update).not.toHaveBeenCalled();
	});
});

describe("MembersService.addSeparators", () => {
	const SEP_A = "111111111111111111";
	const SEP_B = "222222222222222222";

	function serviceAvec(options: {
		status?: string | null;
		separateurs?: string[];
		portes?: string[];
	}) {
		const create = jest.fn().mockImplementation(({ data }) =>
			Promise.resolve({ id: "req-1", roleIds: data.roleIds, createdAt: new Date(0) }),
		);
		const built = makeService({
			member: {
				findUnique: jest
					.fn()
					.mockResolvedValue(
						options.status === null ? null : { status: options.status ?? "ACTIVE" },
					),
			},
			role: {
				findFirst: jest.fn(),
				update: jest.fn(),
				findMany: jest
					.fn()
					.mockResolvedValue((options.separateurs ?? []).map((id) => ({ id }))),
			},
			memberRole: {
				findMany: jest
					.fn()
					.mockResolvedValue((options.portes ?? []).map((roleId) => ({ roleId }))),
			},
			memberRoleRequest: { create },
		});
		return { ...built, create };
	}

	it("depose une demande sans les separateurs deja portes", async () => {
		const { service, create, audit } = serviceAvec({
			separateurs: [SEP_A, SEP_B],
			portes: [SEP_A],
		});

		const result = await service.addSeparators(USER_ID, [SEP_A, SEP_B], ACTOR);

		expect(create).toHaveBeenCalledWith({
			data: { guildId: "guild-1", userId: USER_ID, roleIds: [SEP_B], requestedById: ACTOR.id },
		});
		expect(result.roleIds).toEqual([SEP_B]);
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ action: "member.separators.add" }),
		);
	});

	// `member-roles:write` est ouverte aux moderateurs : la fiche ne doit pas
	// devenir une porte d'attribution de roles quelconques.
	it("refuse un role qui n'est pas marque separateur", async () => {
		const { service, create } = serviceAvec({ separateurs: [SEP_A] });

		await expect(
			service.addSeparators(USER_ID, [SEP_A, SEP_B], ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(create).not.toHaveBeenCalled();
	});

	it("refuse un membre parti du serveur", async () => {
		const { service, create } = serviceAvec({ status: "LEFT", separateurs: [SEP_A] });

		await expect(service.addSeparators(USER_ID, [SEP_A], ACTOR)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect(create).not.toHaveBeenCalled();
	});

	it("refuse une demande vide une fois retires les roles deja portes", async () => {
		const { service, create } = serviceAvec({ separateurs: [SEP_A], portes: [SEP_A] });

		await expect(service.addSeparators(USER_ID, [SEP_A], ACTOR)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect(create).not.toHaveBeenCalled();
	});
});

describe("MembersService.listRoles", () => {
	it("mappe les roles non supprimes en RoleSummary", async () => {
		const { service } = makeService({
			role: {
				findFirst: jest.fn(),
				update: jest.fn(),
				findMany: jest.fn().mockResolvedValue([
					{
						id: "a",
						name: "A",
						color: 0,
						position: 2,
						managed: false,
						trackHistory: true,
						isSeparator: true,
					},
				]),
			},
		});

		const roles = await service.listRoles();
		expect(roles).toEqual([
			{
				id: "a",
				name: "A",
				color: 0,
				position: 2,
				managed: false,
				trackHistory: true,
				separator: true,
			},
		]);
	});
});
