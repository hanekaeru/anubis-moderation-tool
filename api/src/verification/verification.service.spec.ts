import type { ConfigService } from "@nestjs/config";
import type { AuditService } from "../audit/audit.service";
import type { AppConfig } from "../config/configuration";
import type { PrismaService } from "../prisma/prisma.service";
import { exchangeCodeForUserInfo } from "./battlenet.client";
import { hashBattlenetId } from "./battlenet-hash";
import { VerificationService } from "./verification.service";

const GUILD_ID = "1534550360180396132";
const USER_ID = "136122497891303425";
const STATE = "b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5";
const SECRET = "c".repeat(64);

jest.mock("./battlenet.client", () => ({
	...jest.requireActual("./battlenet.client"),
	exchangeCodeForUserInfo: jest.fn(),
}));

/** Seule frontiere simulee : les appels HTTP a Blizzard. */
const echange = jest.mocked(exchangeCodeForUserInfo);

function demande(overrides: Record<string, unknown> = {}) {
	return {
		state: STATE,
		guildId: GUILD_ID,
		userId: USER_ID,
		createdAt: new Date(),
		expiresAt: new Date(Date.now() + 600_000),
		consumedAt: null,
		...overrides,
	};
}

function makeService(options: {
	available?: boolean;
	demande?: Record<string, unknown> | null;
	consommees?: number;
	lienExistant?: { userId: string; unlinkedAt?: Date | null } | null;
} = {}) {
	const prisma = {
		battlenetVerificationState: {
			findUnique: jest
				.fn()
				.mockResolvedValue(
					options.demande === undefined ? demande() : options.demande,
				),
			updateMany: jest
				.fn()
				.mockResolvedValue({ count: options.consommees ?? 1 }),
		},
		battlenetAccount: {
			findUnique: jest
				.fn()
				.mockResolvedValue(
					options.lienExistant
						? { unlinkedAt: null, ...options.lienExistant }
						: null,
				),
			findMany: jest.fn().mockResolvedValue([]),
			update: jest.fn().mockResolvedValue({}),
			updateMany: jest.fn().mockResolvedValue({ count: 0 }),
			upsert: jest.fn().mockResolvedValue({}),
		},
		quarantineStatus: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
		accountFlag: { create: jest.fn().mockResolvedValue({}) },
		$transaction: jest.fn().mockResolvedValue([]),
	} as unknown as PrismaService;

	const config = {
		get: jest.fn().mockReturnValue({
			battlenet: {
				clientId: "client",
				clientSecret: "secret",
				redirectUri: "https://exemple.test/api/verification/battlenet/callback",
				idSecret: SECRET,
				available: options.available ?? true,
			},
		}),
	} as unknown as ConfigService<{ app: AppConfig }, true>;

	const audit = {
		record: jest.fn().mockResolvedValue(undefined),
	} as unknown as AuditService;

	return { service: new VerificationService(prisma, config, audit), prisma, audit };
}

beforeEach(() => {
	echange.mockReset();
	echange.mockResolvedValue({ sub: "12345", battletag: "Hane#2185" });
});

describe("VerificationService.authorizeUrlFor", () => {
	it("renvoie vers Blizzard avec le state en clair", async () => {
		const { service } = makeService();
		const resultat = await service.authorizeUrlFor(STATE);

		expect(resultat).toEqual({
			url: expect.stringContaining("https://oauth.battle.net/authorize"),
		});
		expect("url" in resultat && resultat.url).toContain(`state=${STATE}`);
	});

	// Le depart ne doit rien consommer : quelqu'un qui ouvre le lien, hesite et
	// recharge la page avant de se connecter doit pouvoir continuer.
	it("ne consomme pas le state", async () => {
		const { service, prisma } = makeService();
		await service.authorizeUrlFor(STATE);

		expect(prisma.battlenetVerificationState.updateMany).not.toHaveBeenCalled();
	});

	it("refuse un state inconnu, expire ou deja consomme", async () => {
		expect(
			await makeService({ demande: null }).service.authorizeUrlFor(STATE),
		).toEqual({ erreur: "lien-invalide" });

		expect(
			await makeService({
				demande: demande({ expiresAt: new Date(Date.now() - 1_000) }),
			}).service.authorizeUrlFor(STATE),
		).toEqual({ erreur: "lien-expire" });

		expect(
			await makeService({
				demande: demande({ consumedAt: new Date() }),
			}).service.authorizeUrlFor(STATE),
		).toEqual({ erreur: "lien-invalide" });
	});

	it("refuse quand aucun client Blizzard n'est configure", async () => {
		const { service } = makeService({ available: false });

		expect(await service.authorizeUrlFor(STATE)).toEqual({
			erreur: "indisponible",
		});
	});
});

describe("VerificationService.handleCallback", () => {
	it("enregistre le lien et rend la main au bot", async () => {
		const { service, prisma } = makeService();

		expect(await service.handleCallback("code", STATE)).toBe("succes");

		// La transaction porte les deux ecritures : le lien et l'etape franchie.
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
		expect(prisma.quarantineStatus.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ discordSyncedAt: null }),
			}),
		);
	});

	// Le coeur de la protection : le state est a usage unique. Sans cela, un
	// retour intercepte se rejoue et lie le compte Blizzard de quelqu'un d'autre.
	it("refuse un state deja consomme par un appel concurrent", async () => {
		const { service } = makeService({ consommees: 0 });

		expect(await service.handleCallback("code", STATE)).toBe("lien-invalide");
		expect(echange).not.toHaveBeenCalled();
	});

	it("consomme le state avant meme d'appeler Blizzard", async () => {
		const { service, prisma } = makeService();
		await service.handleCallback("code", STATE);

		expect(prisma.battlenetVerificationState.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { state: STATE, consumedAt: null } }),
		);
	});

	// Le `sub` ne doit jamais atteindre la base : seule son empreinte est
	// cherchee et ecrite.
	it("n'ecrit que l'empreinte du compte Blizzard", async () => {
		const { service, prisma } = makeService();
		await service.handleCallback("code", STATE);

		const empreinte = hashBattlenetId(SECRET, "12345");
		expect(prisma.battlenetAccount.findUnique).toHaveBeenCalledWith({
			where: { battlenetHash: empreinte },
		});
		expect(prisma.battlenetAccount.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ where: { battlenetHash: empreinte } }),
		);
		expect(
			JSON.stringify(jest.mocked(prisma.battlenetAccount.upsert).mock.calls),
		).not.toContain('"12345"');
	});

	// Un membre qui lie un autre compte Blizzard : l'ancien devient une trace,
	// jamais un compte libre.
	it("transforme l'ancien lien du membre en trace", async () => {
		const { service, prisma } = makeService();
		await service.handleCallback("code", STATE);

		expect(prisma.battlenetAccount.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ userId: USER_ID, unlinkedAt: null }),
				data: expect.objectContaining({ battletag: null }),
			}),
		);
	});

	// La trace existe pour ce cas : delier puis relier le meme compte sur un
	// autre compte Discord ne doit pas passer.
	it("refuse un compte Blizzard delie par un autre membre", async () => {
		const delieLe = new Date("2026-10-01T10:00:00Z");
		const { service, prisma } = makeService({
			lienExistant: { userId: "999999999999999999", unlinkedAt: delieLe },
		});

		expect(await service.handleCallback("code", STATE)).toBe("deja-lie");
		expect(prisma.accountFlag.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					details: {
						dejaLieA: "999999999999999999",
						delieLe: delieLe.toISOString(),
					},
				}),
			}),
		);
	});

	it("refuse un compte Blizzard deja lie et signale la tentative", async () => {
		const { service, prisma } = makeService({
			lienExistant: { userId: "999999999999999999" },
		});

		expect(await service.handleCallback("code", STATE)).toBe("deja-lie");
		expect(prisma.accountFlag.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					type: "BATTLENET_DUPLICATE",
					// `null` : c'est le bot qui portera l'alerte au salon de logs.
					discordSyncedAt: null,
				}),
			}),
		);
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	// Reverification par la meme personne (BattleTag change, lien rejoue) : rien
	// d'anormal, et surtout aucun signalement a lever.
	it("accepte une reverification par le meme membre", async () => {
		const { service, prisma } = makeService({
			lienExistant: { userId: USER_ID },
		});

		expect(await service.handleCallback("code", STATE)).toBe("succes");
		expect(prisma.accountFlag.create).not.toHaveBeenCalled();
	});

	// Le membre revient sur un compte qu'il avait lui-meme delie : la trace
	// redevient un lien, et l'annonce repart.
	it("reactive la trace du meme membre", async () => {
		const { service, prisma } = makeService({
			lienExistant: { userId: USER_ID, unlinkedAt: new Date() },
		});

		expect(await service.handleCallback("code", STATE)).toBe("succes");
		expect(prisma.battlenetAccount.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				update: expect.objectContaining({
					unlinkedAt: null,
					discordSyncedAt: null,
				}),
			}),
		);
	});

	it("traite un retour sans code comme un refus", async () => {
		const { service } = makeService();

		expect(await service.handleCallback(undefined, STATE)).toBe(
			"refus-blizzard",
		);
	});

	it("remonte un echec Blizzard sans consommer deux fois", async () => {
		echange.mockRejectedValue(new Error("réseau"));
		const { service } = makeService();

		expect(await service.handleCallback("code", STATE)).toBe("refus-blizzard");
	});
});

describe("VerificationService.onModuleInit", () => {
	// Les lignes ecrites avant le passage aux empreintes portent le `sub` en
	// clair : elles sont remplacees au demarrage, les empreintes restent.
	it("remplace les identifiants en clair par leur empreinte", async () => {
		const { service, prisma } = makeService();
		const empreinteExistante = hashBattlenetId(SECRET, "777");
		jest
			.mocked(prisma.battlenetAccount.findMany)
			.mockResolvedValue([
				{ battlenetHash: "12345" },
				{ battlenetHash: empreinteExistante },
			] as never);

		await service.onModuleInit();

		expect(prisma.battlenetAccount.update).toHaveBeenCalledTimes(1);
		expect(prisma.battlenetAccount.update).toHaveBeenCalledWith({
			where: { battlenetHash: "12345" },
			data: { battlenetHash: hashBattlenetId(SECRET, "12345") },
		});
	});
});
