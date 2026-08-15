import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import type { CreateSanctionDto, RevokeDto } from "./dto/moderation.dto";
import { SanctionsService } from "./sanctions.service";

const ACTOR: AuthenticatedUser = {
	id: "app-1",
	username: "mod",
	displayName: "Mod",
	role: "MODERATOR",
	permissions: [],
	mustChangePassword: false,
};

const SANCTION_ROW = {
	id: "sanction-1",
	guildId: "guild-1",
	userId: "250902879667879937",
	type: "TIMEOUT",
	status: "ACTIVE",
	reason: "Spam",
	durationSeconds: 3600,
	startsAt: new Date("2026-01-01T00:00:00.000Z"),
	expiresAt: new Date("2026-01-01T01:00:00.000Z"),
	revokedAt: null,
	revokedBy: null,
	revokeReason: null,
	warningId: null,
	evidenceUrl: null,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	user: { id: "250902879667879937", username: "member", globalName: null, avatarUrl: null },
	moderator: null,
	createdBy: { id: "app-1", displayName: "Mod" },
};

function makeService(prismaOverrides: Record<string, unknown> = {}) {
	const prisma = {
		sanction: {
			findMany: jest.fn(),
			count: jest.fn(),
			findFirst: jest.fn(),
			create: jest.fn().mockResolvedValue(SANCTION_ROW),
			update: jest.fn().mockResolvedValue({ ...SANCTION_ROW, status: "REVOKED" }),
			updateMany: jest.fn(),
		},
		member: { findUnique: jest.fn().mockResolvedValue({ userId: "member-1" }) },
		warning: { findFirst: jest.fn() },
		moderationActivity: { create: jest.fn().mockResolvedValue(undefined) },
		...prismaOverrides,
	} as unknown as PrismaService;

	const guild = { guildId: "guild-1" } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return { service: new SanctionsService(prisma, guild, audit), prisma, audit };
}

function createDto(overrides: Partial<CreateSanctionDto> = {}): CreateSanctionDto {
	return {
		userId: "250902879667879937",
		type: "TIMEOUT",
		reason: "Spam repete",
		...overrides,
	} as CreateSanctionDto;
}

describe("SanctionsService.create", () => {
	it("rejette une duree sur un type de sanction instantane", async () => {
		const { service } = makeService();
		await expect(
			service.create(createDto({ type: "KICK", durationSeconds: 3600 }), ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("rejette un TIMEOUT sans duree", async () => {
		const { service } = makeService();
		await expect(
			service.create(createDto({ type: "TIMEOUT", durationSeconds: undefined }), ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("rejette un TIMEOUT au-dela de la limite Discord (28 jours)", async () => {
		const { service } = makeService();
		await expect(
			service.create(
				createDto({ type: "TIMEOUT", durationSeconds: 29 * 24 * 60 * 60 }),
				ACTOR,
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("rejette un membre inconnu sur ce serveur", async () => {
		const { service } = makeService({
			member: { findUnique: jest.fn().mockResolvedValue(null) },
		});
		await expect(
			service.create(createDto({ durationSeconds: 3600 }), ACTOR),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it("rejette un warningId qui n'existe pas ou ne concerne pas ce membre", async () => {
		const { service } = makeService({
			warning: { findFirst: jest.fn().mockResolvedValue(null) },
		});
		await expect(
			service.create(
				createDto({ durationSeconds: 3600, warningId: "warning-1" }),
				ACTOR,
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("cree une sanction instantanee directement EXPIRED", async () => {
		const create = jest.fn().mockResolvedValue(SANCTION_ROW);
		const { service } = makeService({
			sanction: {
				create,
				findFirst: jest.fn(),
				findMany: jest.fn(),
				count: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});

		await service.create(createDto({ type: "KICK" }), ACTOR);

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ status: "EXPIRED", durationSeconds: null }),
			}),
		);
	});

	it("cree une sanction a duree ACTIVE avec expiresAt calcule", async () => {
		const create = jest.fn().mockResolvedValue(SANCTION_ROW);
		const { service } = makeService({
			sanction: {
				create,
				findFirst: jest.fn(),
				findMany: jest.fn(),
				count: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});

		await service.create(createDto({ type: "TIMEOUT", durationSeconds: 3600 }), ACTOR);

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "ACTIVE",
					durationSeconds: 3600,
					expiresAt: expect.any(Date),
				}),
			}),
		);
	});
});

describe("SanctionsService.revoke", () => {
	function revokeDto(): RevokeDto {
		return { reason: "Erreur de moderation" } as RevokeDto;
	}

	it("rejette une sanction introuvable", async () => {
		const { service } = makeService({
			sanction: {
				findFirst: jest.fn().mockResolvedValue(null),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});
		await expect(
			service.revoke("sanction-1", revokeDto(), ACTOR),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it("rejette une sanction deja levee", async () => {
		const { service } = makeService({
			sanction: {
				findFirst: jest.fn().mockResolvedValue({ ...SANCTION_ROW, status: "REVOKED" }),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});
		await expect(
			service.revoke("sanction-1", revokeDto(), ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("rejette une sanction deja terminee (EXPIRED)", async () => {
		const { service } = makeService({
			sanction: {
				findFirst: jest.fn().mockResolvedValue({ ...SANCTION_ROW, status: "EXPIRED" }),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});
		await expect(
			service.revoke("sanction-1", revokeDto(), ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("leve une sanction active et ecrit l'audit", async () => {
		const update = jest.fn().mockResolvedValue({ ...SANCTION_ROW, status: "REVOKED" });
		const { service, audit } = makeService({
			sanction: {
				findFirst: jest.fn().mockResolvedValue(SANCTION_ROW),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update,
				updateMany: jest.fn(),
			},
		});

		await service.revoke("sanction-1", revokeDto(), ACTOR);

		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "sanction-1" },
				data: expect.objectContaining({ status: "REVOKED", revokedById: "app-1" }),
			}),
		);
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ action: "sanction.revoke" }),
		);
	});
});
