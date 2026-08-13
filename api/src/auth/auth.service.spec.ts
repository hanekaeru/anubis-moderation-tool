import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../config/configuration";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { TokenService } from "./token.service";
import { AuthService } from "./auth.service";

jest.setTimeout(20000);

const CORRECT_PASSWORD = "correct horse battery staple";
const OTHER_PASSWORD = "another very different password";

let correctHash: string;

function baseConfig(): AppConfig {
	return {
		nodeEnv: "test",
		isProduction: false,
		port: 3000,
		globalPrefix: "api",
		databaseUrl: "postgresql://localhost/test",
		guildId: "1",
		jwt: {
			accessSecret: "access-secret",
			refreshSecret: "refresh-secret",
			accessTtl: "15m",
			refreshTtlDays: 7,
		},
		corsOrigins: [],
		cookieSecure: false,
		security: { maxFailedLogins: 5, lockoutMinutes: 15 },
	};
}

function account(overrides: Record<string, unknown> = {}) {
	return {
		id: "user-1",
		username: "hanekaeru",
		displayName: "Haneka",
		role: "ADMIN" as const,
		passwordHash: correctHash,
		mustChangePassword: false,
		discordUserId: null,
		lastLoginAt: null,
		failedLoginCount: 0,
		lockedUntil: null,
		isActive: true,
		...overrides,
	};
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
	const prisma = {
		appUser: {
			findUnique: jest.fn(),
			findUniqueOrThrow: jest.fn(),
			update: jest.fn().mockResolvedValue(account()),
			...(prismaOverrides.appUser as object),
		},
	} as unknown as PrismaService;

	const tokens = {
		issueRefreshToken: jest.fn().mockResolvedValue({
			token: "refresh-token",
			expiresAt: new Date("2026-02-01T00:00:00.000Z"),
		}),
		signAccessToken: jest.fn().mockReturnValue("access-token"),
		accessTokenTtlSeconds: jest.fn().mockReturnValue(900),
		revokeToken: jest.fn().mockResolvedValue("user-1"),
		revokeAllForUser: jest.fn().mockResolvedValue(undefined),
	} as unknown as TokenService;

	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	const config = {
		get: jest.fn().mockReturnValue(baseConfig()),
	} as unknown as ConfigService<{ app: AppConfig }, true>;

	return { service: new AuthService(prisma, tokens, audit, config), prisma, tokens, audit };
}

beforeAll(async () => {
	correctHash = await AuthService.hashPassword(CORRECT_PASSWORD);
});

describe("login", () => {
	it("rejette un identifiant inconnu avec un message generique", async () => {
		const { service, prisma } = makeService({
			appUser: { findUnique: jest.fn().mockResolvedValue(null) },
		});

		await expect(
			service.login("ghost", CORRECT_PASSWORD, {}),
		).rejects.toBeInstanceOf(UnauthorizedException);
		expect(prisma.appUser.update).not.toHaveBeenCalled();
	});

	it("incremente le compteur d'echecs sur un mauvais mot de passe", async () => {
		const update = jest.fn().mockResolvedValue(account());
		const { service } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(account({ failedLoginCount: 1 })),
				update,
			},
		});

		await expect(
			service.login("hanekaeru", OTHER_PASSWORD, {}),
		).rejects.toBeInstanceOf(UnauthorizedException);

		expect(update).toHaveBeenCalledWith({
			where: { id: "user-1" },
			data: { failedLoginCount: 2 },
		});
	});

	it("verrouille le compte au seuil configure, sans l'annoncer sur ce refus", async () => {
		const update = jest.fn().mockResolvedValue(account());
		const { service } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(account({ failedLoginCount: 4 })),
				update,
			},
		});

		await expect(
			service.login("hanekaeru", OTHER_PASSWORD, {}),
		).rejects.toBeInstanceOf(UnauthorizedException);

		expect(update).toHaveBeenCalledWith({
			where: { id: "user-1" },
			data: { failedLoginCount: 0, lockedUntil: expect.any(Date) },
		});
	});

	it("refuse un compte verrouille seulement apres avoir valide le mot de passe", async () => {
		const { service } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(
					account({ lockedUntil: new Date(Date.now() + 60_000) }),
				),
			},
		});

		await expect(
			service.login("hanekaeru", CORRECT_PASSWORD, {}),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("refuse un compte desactive apres avoir valide le mot de passe", async () => {
		const { service } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(account({ isActive: false })),
			},
		});

		await expect(
			service.login("hanekaeru", CORRECT_PASSWORD, {}),
		).rejects.toBeInstanceOf(UnauthorizedException);
	});

	it("reussit avec les bons identifiants : reset des compteurs, jeton emis, audit ecrit", async () => {
		const update = jest.fn().mockResolvedValue(account());
		const { service, tokens, audit } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(account({ failedLoginCount: 2 })),
				update,
			},
		});

		const result = await service.login("hanekaeru", CORRECT_PASSWORD, {
			ip: "127.0.0.1",
		});

		expect(update).toHaveBeenCalledWith({
			where: { id: "user-1" },
			data: {
				lastLoginAt: expect.any(Date),
				failedLoginCount: 0,
				lockedUntil: null,
			},
		});
		expect(tokens.issueRefreshToken).toHaveBeenCalledWith("user-1", {
			ip: "127.0.0.1",
			userAgent: undefined,
		});
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ appUserId: "user-1", action: "auth.login" }),
		);
		expect(result.accessToken).toBe("access-token");
		expect(result.user.username).toBe("hanekaeru");
	});
});

describe("changePassword", () => {
	it("rejette un mauvais mot de passe actuel", async () => {
		const { service } = makeService({
			appUser: {
				findUniqueOrThrow: jest.fn().mockResolvedValue(account()),
			},
		});

		await expect(
			service.changePassword("user-1", OTHER_PASSWORD, "new password", {}),
		).rejects.toBeInstanceOf(UnauthorizedException);
	});

	it("rejette un nouveau mot de passe identique a l'ancien", async () => {
		const { service } = makeService({
			appUser: {
				findUniqueOrThrow: jest.fn().mockResolvedValue(account()),
			},
		});

		await expect(
			service.changePassword("user-1", CORRECT_PASSWORD, CORRECT_PASSWORD, {}),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("change le mot de passe et revoque toutes les sessions", async () => {
		const update = jest.fn().mockResolvedValue(undefined);
		const { service, tokens, audit } = makeService({
			appUser: {
				findUniqueOrThrow: jest.fn().mockResolvedValue(account()),
				update,
			},
		});

		await service.changePassword("user-1", CORRECT_PASSWORD, "a brand new password", {});

		expect(update).toHaveBeenCalledWith({
			where: { id: "user-1" },
			data: {
				passwordHash: expect.any(String),
				mustChangePassword: false,
			},
		});
		expect(tokens.revokeAllForUser).toHaveBeenCalledWith("user-1");
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ action: "auth.password_changed" }),
		);
	});
});

describe("toSessionUser", () => {
	it("derive les permissions du role et formate lastLoginAt", () => {
		const { service } = makeService();
		const session = service.toSessionUser(
			account({ lastLoginAt: new Date("2026-01-01T00:00:00.000Z") }),
		);

		expect(session.role).toBe("ADMIN");
		expect(session.permissions.length).toBeGreaterThan(0);
		expect(session.lastLoginAt).toBe("2026-01-01T00:00:00.000Z");
	});

	it("renvoie lastLoginAt a null quand le compte ne s'est jamais connecte", () => {
		const { service } = makeService();
		const session = service.toSessionUser(account({ lastLoginAt: null }));
		expect(session.lastLoginAt).toBeNull();
	});
});
