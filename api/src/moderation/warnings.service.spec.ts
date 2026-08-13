import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import type { CreateWarningDto, RevokeDto } from "./dto/moderation.dto";
import { WarningsService } from "./warnings.service";

const ACTOR: AuthenticatedUser = {
	id: "app-1",
	username: "mod",
	displayName: "Mod",
	role: "MODERATOR",
	permissions: [],
	mustChangePassword: false,
};

function warningRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "warning-1",
		guildId: "guild-1",
		userId: "250902879667879937",
		reason: "Langage inapproprie",
		severity: "LOW",
		points: 1,
		expiresAt: null,
		revokedAt: null,
		revokedBy: null,
		revokeReason: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		user: { id: "250902879667879937", username: "member", globalName: null, avatarHash: null },
		moderator: null,
		createdBy: { id: "app-1", displayName: "Mod" },
		...overrides,
	};
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
	const prisma = {
		warning: {
			findMany: jest.fn(),
			count: jest.fn(),
			findFirst: jest.fn(),
			create: jest.fn().mockResolvedValue(warningRow()),
			update: jest.fn().mockResolvedValue(warningRow({ revokedAt: new Date() })),
		},
		member: { findUnique: jest.fn().mockResolvedValue({ userId: "250902879667879937" }) },
		moderationActivity: { create: jest.fn().mockResolvedValue(undefined) },
		...prismaOverrides,
	} as unknown as PrismaService;

	const guild = { guildId: "guild-1" } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return { service: new WarningsService(prisma, guild, audit), prisma, audit };
}

function createDto(overrides: Partial<CreateWarningDto> = {}): CreateWarningDto {
	return {
		userId: "250902879667879937",
		reason: "Langage inapproprie",
		severity: "LOW",
		points: 1,
		...overrides,
	} as CreateWarningDto;
}

describe("WarningsService.create", () => {
	it("rejette un membre inconnu sur ce serveur", async () => {
		const { service } = makeService({
			member: { findUnique: jest.fn().mockResolvedValue(null) },
		});
		await expect(service.create(createDto(), ACTOR)).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it("rejette une date d'expiration dans le passe", async () => {
		const { service } = makeService();
		await expect(
			service.create(
				createDto({ expiresAt: new Date(Date.now() - 60_000).toISOString() }),
				ACTOR,
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("cree l'avertissement quand tout est valide", async () => {
		const create = jest.fn().mockResolvedValue(warningRow());
		const { service, audit } = makeService({
			warning: { create, findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
		});

		await service.create(createDto(), ACTOR);

		expect(create).toHaveBeenCalled();
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ action: "warning.create" }),
		);
	});
});

describe("WarningsService — isActive derive de la revocation et de l'expiration", () => {
	it("est actif sans revocation ni expiration", async () => {
		const { service } = makeService({
			warning: {
				findFirst: jest.fn().mockResolvedValue(warningRow()),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
			},
		});
		const dto = await service.findOne("warning-1");
		expect(dto.isActive).toBe(true);
	});

	it("n'est plus actif une fois revoque", async () => {
		const { service } = makeService({
			warning: {
				findFirst: jest.fn().mockResolvedValue(warningRow({ revokedAt: new Date() })),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
			},
		});
		const dto = await service.findOne("warning-1");
		expect(dto.isActive).toBe(false);
	});

	it("n'est plus actif une fois expire", async () => {
		const { service } = makeService({
			warning: {
				findFirst: jest
					.fn()
					.mockResolvedValue(warningRow({ expiresAt: new Date(Date.now() - 60_000) })),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
			},
		});
		const dto = await service.findOne("warning-1");
		expect(dto.isActive).toBe(false);
	});
});

describe("WarningsService.revoke", () => {
	it("rejette un avertissement introuvable", async () => {
		const { service } = makeService({
			warning: {
				findFirst: jest.fn().mockResolvedValue(null),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
			},
		});
		await expect(
			service.revoke("warning-1", { reason: "Erreur" } as RevokeDto, ACTOR),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it("rejette un avertissement deja revoque", async () => {
		const { service } = makeService({
			warning: {
				findFirst: jest.fn().mockResolvedValue(warningRow({ revokedAt: new Date() })),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
			},
		});
		await expect(
			service.revoke("warning-1", { reason: "Erreur" } as RevokeDto, ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});
});
