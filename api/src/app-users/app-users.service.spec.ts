import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
} from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import type { TokenService } from "../auth/token.service";
import type { TwoFactorService } from "../auth/two-factor.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { AppUsersService } from "./app-users.service";

jest.setTimeout(20000);

function actor(role: AuthenticatedUser["role"], id = "actor-1"): AuthenticatedUser {
	return {
		id,
		username: "actor",
		displayName: "Actor",
		role,
		permissions: [],
		mustChangePassword: false,
	};
}

function userRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "target-1",
		username: "target",
		displayName: "Target",
		role: "VIEWER",
		isActive: true,
		mustChangePassword: false,
		discordUserId: null,
		lastLoginAt: null,
		lockedUntil: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		createdBy: null,
		...overrides,
	};
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
	const prisma = {
		appUser: {
			findMany: jest.fn(),
			count: jest.fn().mockResolvedValue(1),
			findUnique: jest.fn().mockResolvedValue(null),
			create: jest.fn().mockResolvedValue(userRow()),
			update: jest.fn().mockResolvedValue(userRow()),
			...(prismaOverrides.appUser as object),
		},
	} as unknown as PrismaService;

	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
	const tokens = {
		revokeAllForUser: jest.fn().mockResolvedValue(undefined),
	} as unknown as TokenService;
	const twoFactor = {
		reset: jest.fn().mockResolvedValue(undefined),
	} as unknown as TwoFactorService;

	return {
		service: new AppUsersService(prisma, audit, tokens, twoFactor),
		prisma,
		audit,
		tokens,
		twoFactor,
	};
}

describe("AppUsersService.create", () => {
	it("refuse de creer un compte de rang egal ou superieur au sien", async () => {
		const { service } = makeService();
		await expect(
			service.create(
				{ username: "new", displayName: "New", role: "ADMIN" },
				actor("MODERATOR"),
			),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("rejette un identifiant deja utilise", async () => {
		const { service } = makeService({
			appUser: { findUnique: jest.fn().mockResolvedValue(userRow()) },
		});
		await expect(
			service.create(
				{ username: "target", displayName: "New", role: "VIEWER" },
				actor("OWNER"),
			),
		).rejects.toBeInstanceOf(ConflictException);
	});

	it("genere un mot de passe quand aucun n'est fourni", async () => {
		const { service } = makeService();
		const result = await service.create(
			{ username: "new", displayName: "New", role: "VIEWER" },
			actor("OWNER"),
		);
		expect(result.generatedPassword).toEqual(expect.any(String));
	});

	it("ne genere pas de mot de passe quand un est fourni explicitement", async () => {
		const { service } = makeService();
		const result = await service.create(
			{
				username: "new",
				displayName: "New",
				role: "VIEWER",
				password: "a very explicit password",
			},
			actor("OWNER"),
		);
		expect(result.generatedPassword).toBeNull();
	});
});

describe("AppUsersService.update", () => {
	it("refuse de modifier son propre role", async () => {
		const { service } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(userRow({ id: "actor-1", role: "ADMIN" })),
			},
		});
		await expect(
			service.update("actor-1", { role: "OWNER" }, actor("ADMIN", "actor-1")),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("refuse de desactiver son propre compte", async () => {
		const { service } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(userRow({ id: "actor-1", role: "ADMIN" })),
			},
		});
		await expect(
			service.update("actor-1", { isActive: false }, actor("ADMIN", "actor-1")),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("refuse de gerer un autre compte OWNER, meme pour le desactiver (aucun rang ne depasse OWNER)", async () => {
		// `assertNotLastOwner` n'est donc jamais atteint via `update()` : le
		// controle de rang bloque plus tot des qu'un autre OWNER est vise.
		const { service } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(userRow({ id: "owner-1", role: "OWNER" })),
				count: jest.fn().mockResolvedValue(0),
			},
		});
		await expect(
			service.update("owner-1", { isActive: false }, actor("OWNER", "actor-1")),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("revoque les sessions quand le role change", async () => {
		const { service, tokens } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(userRow({ role: "VIEWER" })),
				update: jest.fn().mockResolvedValue(userRow({ role: "MODERATOR" })),
			},
		});

		await service.update("target-1", { role: "MODERATOR" }, actor("OWNER"));

		expect(tokens.revokeAllForUser).toHaveBeenCalledWith("target-1");
	});

	it("ne revoque rien quand ni le role ni l'activation ne changent", async () => {
		const { service, tokens } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(userRow({ role: "VIEWER" })),
				update: jest.fn().mockResolvedValue(userRow({ displayName: "Nouveau nom" })),
			},
		});

		await service.update("target-1", { displayName: "Nouveau nom" }, actor("OWNER"));

		expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
	});
});

describe("AppUsersService.resetPassword / unlock", () => {
	it("resetPassword refuse un rang egal ou superieur", async () => {
		const { service } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(userRow({ role: "ADMIN" })),
			},
		});
		await expect(
			service.resetPassword("target-1", actor("ADMIN")),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("unlock refuse un rang egal ou superieur", async () => {
		const { service } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(userRow({ role: "OWNER" })),
			},
		});
		await expect(service.unlock("target-1", actor("ADMIN"))).rejects.toBeInstanceOf(
			ForbiddenException,
		);
	});

	it("resetPassword genere un nouveau mot de passe et revoque les sessions", async () => {
		const { service, tokens } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(userRow({ role: "VIEWER" })),
				update: jest.fn().mockResolvedValue(undefined),
			},
		});

		const result = await service.resetPassword("target-1", actor("OWNER"));

		expect(result.generatedPassword).toEqual(expect.any(String));
		expect(tokens.revokeAllForUser).toHaveBeenCalledWith("target-1");
	});
});

// Sanity check : verifie que le mock d'AuthService.hashPassword n'est pas requis,
// le vrai hachage (argon2) tourne dans ces tests.
describe("AuthService.hashPassword", () => {
	it("produit un hash different de la valeur en clair", async () => {
		const hash = await AuthService.hashPassword("secret");
		expect(hash).not.toBe("secret");
	});
});
