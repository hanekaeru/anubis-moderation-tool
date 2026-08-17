import type { ConfigService } from "@nestjs/config";
import type { JwtService } from "@nestjs/jwt";
import type { AppConfig } from "../config/configuration";
import type { PrismaService } from "../prisma/prisma.service";
import { TokenService } from "./token.service";

function baseConfig(overrides: Partial<AppConfig["jwt"]> = {}): AppConfig {
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
			...overrides,
		},
		corsOrigins: [],
		cookieSecure: false,
		security: {
		maxFailedLogins: 5,
		lockoutMinutes: 15,
		twoFactorEnabled: true,
	},
	};
}

function makeService(
	prismaOverrides: Record<string, unknown> = {},
	jwtOverrides: Record<string, unknown> = {},
	appConfig: AppConfig = baseConfig(),
) {
	const prisma = {
		refreshToken: {
			create: jest.fn().mockResolvedValue(undefined),
			findUnique: jest.fn(),
			update: jest.fn().mockResolvedValue(undefined),
			updateMany: jest.fn().mockResolvedValue({ count: 0 }),
			deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
		},
		...prismaOverrides,
	} as unknown as PrismaService;

	const jwt = {
		sign: jest.fn().mockReturnValue("signed.jwt.token"),
		...jwtOverrides,
	} as unknown as JwtService;

	const config = {
		get: jest.fn().mockReturnValue(appConfig),
	} as unknown as ConfigService<{ app: AppConfig }, true>;

	return new TokenService(jwt, prisma, config);
}

describe("accessTokenTtlSeconds", () => {
	it.each([
		["15m", 900],
		["1h", 3600],
		["7d", 604800],
		["30s", 30],
	])("convertit %s en %d secondes", (accessTtl, expected) => {
		const service = makeService({}, {}, baseConfig({ accessTtl }));
		expect(service.accessTokenTtlSeconds()).toBe(expected);
	});

	it("retombe sur 900 quand le format est invalide", () => {
		const service = makeService({}, {}, baseConfig({ accessTtl: "bogus" }));
		expect(service.accessTokenTtlSeconds()).toBe(900);
	});
});

describe("rotateRefreshToken", () => {
	it("renvoie null quand le jeton est inconnu", async () => {
		const findUnique = jest.fn().mockResolvedValue(null);
		const service = makeService({
			refreshToken: { findUnique, create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
		});

		expect(await service.rotateRefreshToken("unknown", {})).toBeNull();
	});

	it("renvoie null et ne touche a rien quand le jeton est expire", async () => {
		const updateMany = jest.fn();
		const findUnique = jest.fn().mockResolvedValue({
			id: "rt-1",
			appUserId: "user-1",
			familyId: "family-1",
			revokedAt: null,
			expiresAt: new Date(Date.now() - 1000),
			appUser: { id: "user-1", isActive: true },
		});
		const service = makeService({
			refreshToken: { findUnique, create: jest.fn(), update: jest.fn(), updateMany },
		});

		expect(await service.rotateRefreshToken("expired", {})).toBeNull();
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("renvoie null quand le compte est desactive", async () => {
		const findUnique = jest.fn().mockResolvedValue({
			id: "rt-1",
			appUserId: "user-1",
			familyId: "family-1",
			revokedAt: null,
			expiresAt: new Date(Date.now() + 1000 * 60),
			appUser: { id: "user-1", isActive: false },
		});
		const service = makeService({
			refreshToken: { findUnique, create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
		});

		expect(await service.rotateRefreshToken("token", {})).toBeNull();
	});

	it("revoque toute la famille quand un jeton deja revoque est rejoue", async () => {
		const updateMany = jest.fn().mockResolvedValue({ count: 2 });
		const findUnique = jest.fn().mockResolvedValue({
			id: "rt-1",
			appUserId: "user-1",
			familyId: "family-1",
			revokedAt: new Date(),
			expiresAt: new Date(Date.now() + 1000 * 60),
			appUser: { id: "user-1", isActive: true },
		});
		const service = makeService({
			refreshToken: { findUnique, create: jest.fn(), update: jest.fn(), updateMany },
		});

		expect(await service.rotateRefreshToken("replayed", {})).toBeNull();
		expect(updateMany).toHaveBeenCalledWith({
			where: { familyId: "family-1", revokedAt: null },
			data: { revokedAt: expect.any(Date) },
		});
	});

	it("fait tourner un jeton valide : nouveau jeton emis, ancien revoque", async () => {
		const stored = {
			id: "rt-1",
			appUserId: "user-1",
			familyId: "family-1",
			revokedAt: null,
			expiresAt: new Date(Date.now() + 1000 * 60),
			appUser: { id: "user-1", isActive: true },
		};
		const findUnique = jest
			.fn()
			.mockResolvedValueOnce(stored)
			.mockResolvedValueOnce({ id: "rt-2" });
		const create = jest.fn().mockResolvedValue(undefined);
		const update = jest.fn().mockResolvedValue(undefined);
		const service = makeService({
			refreshToken: { findUnique, create, update, updateMany: jest.fn() },
		});

		const result = await service.rotateRefreshToken("valid", {});

		expect(result).not.toBeNull();
		expect(result!.appUserId).toBe("user-1");
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					appUserId: "user-1",
					familyId: "family-1",
				}),
			}),
		);
		expect(update).toHaveBeenCalledWith({
			where: { id: "rt-1" },
			data: { revokedAt: expect.any(Date), replacedById: "rt-2" },
		});
	});
});
