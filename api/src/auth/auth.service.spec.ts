import {
	BadRequestException,
	ForbiddenException,
	UnauthorizedException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../config/configuration";
import type { PrismaService } from "../prisma/prisma.service";
import { permissionsForRole, type AppUserRole } from "@anubis/shared";
import type { AuditService } from "../audit/audit.service";
import type { RolePermissionsService } from "../role-permissions/role-permissions.service";
import type { TokenService } from "./token.service";
import type { TwoFactorService } from "./two-factor.service";
import { AuthService, isPendingSecondFactor } from "./auth.service";

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
		security: {
			maxFailedLogins: 5,
			lockoutMinutes: 15,
			twoFactorEnabled: true,
		},
		battlenet: {
			clientId: "",
			clientSecret: "",
			redirectUri: "",
			available: false,
		},
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
		totpEnabledAt: null,
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
		signChallengeToken: jest
			.fn()
			.mockReturnValue({ token: "challenge-token", expiresIn: 300 }),
		verifyChallengeToken: jest.fn().mockReturnValue("user-1"),
	} as unknown as TokenService;

	// `available` est un accesseur en production : le double le presente comme
	// une propriete mutable, pour que les tests puissent couper l'interrupteur.
	const twoFactor = {
		verifySecondFactor: jest.fn().mockResolvedValue(true),
		available: true,
	} as unknown as TwoFactorService & { available: boolean };

	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	const config = {
		get: jest.fn().mockReturnValue(baseConfig()),
	} as unknown as ConfigService<{ app: AppConfig }, true>;

	// Les permissions viennent desormais du service de matrice, pas d'une
	// constante : ce double se contente de renvoyer les defauts du role.
	const rolePermissions = {
		resolve: jest.fn(async (role: AppUserRole) => [...permissionsForRole(role)]),
	} as unknown as RolePermissionsService;

	return {
		service: new AuthService(
			prisma,
			tokens,
			audit,
			config,
			rolePermissions,
			twoFactor,
		),
		prisma,
		tokens,
		audit,
		twoFactor,
	};
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

		if (isPendingSecondFactor(result)) {
			throw new Error("Une session complete etait attendue.");
		}
		expect(result.accessToken).toBe("access-token");
		expect(result.user.username).toBe("hanekaeru");
	});
});

describe("double authentification", () => {
	it("n'emet aucun jeton quand le compte est protege : seulement un defi", async () => {
		const update = jest.fn().mockResolvedValue(account());
		const { service, tokens, audit } = makeService({
			appUser: {
				findUnique: jest
					.fn()
					.mockResolvedValue(account({ totpEnabledAt: new Date() })),
				update,
			},
		});

		const result = await service.login("hanekaeru", CORRECT_PASSWORD, {});

		expect(isPendingSecondFactor(result)).toBe(true);
		expect(tokens.issueRefreshToken).not.toHaveBeenCalled();
		// La connexion n'a pas eu lieu : ni `lastLoginAt`, ni entree de journal.
		expect(update).not.toHaveBeenCalled();
		expect(audit.record).not.toHaveBeenCalled();
	});

	it("ouvre la session une fois le code valide", async () => {
		const { service, tokens, audit } = makeService({
			appUser: {
				findUnique: jest
					.fn()
					.mockResolvedValue(account({ totpEnabledAt: new Date() })),
				update: jest.fn().mockResolvedValue(account()),
			},
		});

		const result = await service.completeTwoFactorLogin("challenge", "123456", {});

		expect(result.accessToken).toBe("access-token");
		expect(tokens.issueRefreshToken).toHaveBeenCalled();
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ action: "auth.login" }),
		);
	});

	it("compte un code errone comme un echec de connexion", async () => {
		const update = jest.fn().mockResolvedValue(account());
		const { service, twoFactor } = makeService({
			appUser: {
				findUnique: jest
					.fn()
					.mockResolvedValue(account({ totpEnabledAt: new Date(), failedLoginCount: 1 })),
				update,
			},
		});

		(twoFactor.verifySecondFactor as jest.Mock).mockResolvedValue(false);

		await expect(
			service.completeTwoFactorLogin("challenge", "000000", {}),
		).rejects.toBeInstanceOf(UnauthorizedException);

		expect(update).toHaveBeenCalledWith({
			where: { id: "user-1" },
			data: { failedLoginCount: 2 },
		});
	});

	it("refuse un defi expire ou forge", async () => {
		const { service, tokens } = makeService();
		(tokens.verifyChallengeToken as jest.Mock).mockReturnValue(null);

		await expect(
			service.completeTwoFactorLogin("n-importe-quoi", "123456", {}),
		).rejects.toBeInstanceOf(UnauthorizedException);
	});

	// Un compte desactive entre les deux etapes ne doit pas passer : le defi ne
	// prouve que le mot de passe, pas l'etat courant du compte.
	it("refuse un compte desactive entre les deux etapes", async () => {
		const { service } = makeService({
			appUser: {
				findUnique: jest.fn().mockResolvedValue(account({ isActive: false })),
			},
		});

		await expect(
			service.completeTwoFactorLogin("challenge", "123456", {}),
		).rejects.toBeInstanceOf(UnauthorizedException);
	});

	// C'est tout l'objet de `TWO_FACTOR_ENABLED=false` : un compte deja protege
	// se connecte avec son seul mot de passe, sans avoir rien a defaire.
	it("court-circuite le second facteur quand le deploiement l'a coupe", async () => {
		const { service, twoFactor, tokens } = makeService({
			appUser: {
				findUnique: jest
					.fn()
					.mockResolvedValue(account({ totpEnabledAt: new Date() })),
				update: jest.fn().mockResolvedValue(account()),
			},
		});

		twoFactor.available = false;

		const result = await service.login("hanekaeru", CORRECT_PASSWORD, {});

		expect(isPendingSecondFactor(result)).toBe(false);
		expect(tokens.signChallengeToken).not.toHaveBeenCalled();
		expect(tokens.issueRefreshToken).toHaveBeenCalled();
	});
});

describe("changePassword", () => {
	it("rejette un mauvais mot de passe actuel", async () => {
		const { service } = makeService({
			appUser: {
				findUniqueOrThrow: jest.fn().mockResolvedValue(account()),
			},
		});

		// 400 et non 401 : la requete est authentifiee, c'est le champ qui est
		// faux. En 401, le dashboard y voyait un jeton expire et deconnectait.
		await expect(
			service.changePassword("user-1", OTHER_PASSWORD, "new password", {}),
		).rejects.toBeInstanceOf(BadRequestException);
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
	it("derive les permissions du role et formate lastLoginAt", async () => {
		const { service } = makeService();
		const session = await service.toSessionUser(
			account({ lastLoginAt: new Date("2026-01-01T00:00:00.000Z") }),
		);

		expect(session.role).toBe("ADMIN");
		expect(session.permissions.length).toBeGreaterThan(0);
		expect(session.lastLoginAt).toBe("2026-01-01T00:00:00.000Z");
	});

	it("renvoie lastLoginAt a null quand le compte ne s'est jamais connecte", async () => {
		const { service } = makeService();
		const session = await service.toSessionUser(account({ lastLoginAt: null }));
		expect(session.lastLoginAt).toBeNull();
	});
});
