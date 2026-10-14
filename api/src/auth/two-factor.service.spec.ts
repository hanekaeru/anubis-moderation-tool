import { ForbiddenException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { AuditService } from "../audit/audit.service";
import type { AppConfig } from "../config/configuration";
import type { PrismaService } from "../prisma/prisma.service";
import type { TokenService } from "./token.service";
import { TwoFactorService } from "./two-factor.service";

jest.setTimeout(20000);

function baseConfig(twoFactorEnabled: boolean): AppConfig {
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
		security: { maxFailedLogins: 5, lockoutMinutes: 15, twoFactorEnabled },
		battlenet: { clientId: "", clientSecret: "", redirectUri: "", available: false },
		pandascore: { token: "", available: false },
	};
}

function makeService(twoFactorEnabled: boolean) {
	const prisma = {
		appUser: {
			findUnique: jest.fn(),
			findUniqueOrThrow: jest.fn().mockResolvedValue({
				username: "hanekaeru",
				totpSecret: null,
				totpEnabledAt: null,
			}),
			update: jest.fn(),
			updateMany: jest.fn(),
		},
		twoFactorRecoveryCode: {
			count: jest.fn().mockResolvedValue(7),
			findMany: jest.fn().mockResolvedValue([]),
			deleteMany: jest.fn(),
			createMany: jest.fn(),
			updateMany: jest.fn(),
		},
		$transaction: jest.fn(),
	} as unknown as PrismaService;

	const tokens = {
		revokeAllForUser: jest.fn().mockResolvedValue(0),
	} as unknown as TokenService;

	const audit = {
		record: jest.fn().mockResolvedValue(undefined),
	} as unknown as AuditService;

	const config = {
		get: jest.fn().mockReturnValue(baseConfig(twoFactorEnabled)),
	} as unknown as ConfigService<{ app: AppConfig }, true>;

	return {
		service: new TwoFactorService(prisma, tokens, audit, config),
		prisma,
	};
}

describe("TWO_FACTOR_ENABLED", () => {
	it("ouvre la configuration quand le deploiement l'accepte", () => {
		expect(makeService(true).service.available).toBe(true);
	});

	/*
	 * Laisser activer une protection inerte serait pire que de la refuser : le
	 * compte se croirait protege alors que sa connexion ne demande toujours que
	 * le mot de passe.
	 */
	it("ferme la preparation, l'activation et la regeneration quand elle est coupee", async () => {
		const { service } = makeService(false);

		expect(service.available).toBe(false);
		await expect(service.prepare("user-1")).rejects.toBeInstanceOf(ForbiddenException);
		await expect(service.enable("user-1", "123456", {})).rejects.toBeInstanceOf(
			ForbiddenException,
		);
		await expect(
			service.regenerateRecoveryCodes("user-1", "123456", {}),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	// Un compte protege avant la coupure doit pouvoir faire le menage, sans quoi
	// son secret resterait en base sans aucun moyen de s'en defaire.
	it("laisse desactiver malgre la coupure", async () => {
		const { service, prisma } = makeService(false);

		(prisma.appUser.findUniqueOrThrow as jest.Mock).mockResolvedValue({
			passwordHash: "pas-un-hash-valide",
			totpSecret: null,
			totpEnabledAt: null,
		});

		// Le refus attendu porte sur l'etat du compte (« pas active »), pas sur la
		// disponibilite : la route n'est donc pas fermee par l'interrupteur.
		await expect(
			service.disable("user-1", "mot-de-passe", "123456", {}),
		).rejects.not.toBeInstanceOf(ForbiddenException);
	});

	it("annonce la coupure dans l'etat, sans masquer la configuration du compte", async () => {
		const { service, prisma } = makeService(false);
		const enabledAt = new Date("2026-08-01T10:00:00.000Z");

		(prisma.appUser.findUniqueOrThrow as jest.Mock).mockResolvedValue({
			totpEnabledAt: enabledAt,
		});

		const status = await service.status("user-1");

		expect(status.available).toBe(false);
		// Le secret existe toujours : le masquer laisserait croire qu'il faudra
		// tout reconfigurer au retour.
		expect(status.enabled).toBe(true);
		expect(status.enabledAt).toBe(enabledAt.toISOString());
		expect(status.remainingRecoveryCodes).toBe(7);
	});
});
