import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { AppConfig } from "../config/configuration";
import type { PrismaService } from "../prisma/prisma.service";
import { EsportImportService } from "./esport-import.service";
import type { EsportService } from "./esport.service";
import type { PandascoreRawMatch } from "./pandascore.client";

const GUILD_ID = "1534550360180396132";
const ACTOR = { id: "app-1", permissions: [] } as unknown as AuthenticatedUser;
const WEEK = { id: "week-1", guildId: GUILD_ID, weekStart: new Date("2026-10-12T00:00:00Z") };

function raw(id: number, scheduledAt: string): PandascoreRawMatch {
	return {
		id,
		league_id: 5223,
		scheduled_at: scheduledAt,
		status: "not_started",
		match_type: "first_to",
		number_of_games: 3,
		serie: { name: "EMEA Stage 3" },
		opponents: [
			{ opponent: { id: 10, name: "Twisted Minds" } },
			{ opponent: { id: 20, name: "Team Risk" } },
		],
	};
}

function makeService(cache: PandascoreRawMatch[], overrides: Record<string, any> = {}) {
	const prisma: Record<string, any> = {
		esportConfig: { findUnique: jest.fn().mockResolvedValue(null) },
		pandascoreMatch: {
			findMany: jest.fn().mockResolvedValue(cache.map((data) => ({ id: data.id, data }))),
			findUnique: jest.fn(),
		},
		pandascoreFetch: { findUnique: jest.fn().mockResolvedValue(null) },
		esportMatch: {
			findMany: jest.fn().mockResolvedValue([]),
			count: jest.fn().mockResolvedValue(0),
			create: jest.fn(),
			update: jest.fn(),
		},
		esportTeam: {
			findUnique: jest.fn().mockResolvedValue(null),
			findFirst: jest.fn().mockResolvedValue(null),
			create: jest.fn(({ data }) => Promise.resolve({ id: `team-${data.pandascoreId}` })),
			update: jest.fn(),
		},
		...overrides,
	};
	prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));

	const esport = {
		loadWeek: jest.fn().mockResolvedValue(WEEK),
		findWeek: jest.fn().mockResolvedValue({ id: WEEK.id }),
		resynchroniser: jest.fn(),
		verifierTaille: jest.fn(),
	} as unknown as EsportService;
	const config = {
		get: () => ({ pandascore: { token: "jeton-de-test", available: true } }),
	} as unknown as ConfigService<{ app: AppConfig }, true>;

	const service = new EsportImportService(
		prisma as unknown as PrismaService,
		{ guildId: GUILD_ID } as unknown as GuildContextService,
		{ record: jest.fn() } as unknown as AuditService,
		config,
		esport,
	);
	return { service, prisma, esport };
}

describe("EsportImportService.import", () => {
	// Samedi 17 octobre, 21 h a Paris.
	const SAMEDI = "2026-10-17T19:00:00Z";

	it("cree le match et ses equipes depuis le cache, sans rappeler PandaScore", async () => {
		const fetchSpy = jest.spyOn(global, "fetch");
		const { service, prisma, esport } = makeService([raw(1, SAMEDI)]);

		await service.import("week-1", [1], ACTOR);

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(prisma.esportTeam.create).toHaveBeenCalledTimes(2);
		expect(prisma.esportMatch.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				weekId: "week-1",
				pandascoreId: 1,
				teamAId: "team-10",
				teamBId: "team-20",
				format: "FIRST_TO",
				bestOf: 3,
				competition: "OWCS EMEA Stage 3",
				region: "EMEA",
			}),
		});
		expect(esport.verifierTaille).toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("relie une equipe saisie a la main portant le meme nom", async () => {
		const { service, prisma } = makeService([raw(1, SAMEDI)]);
		prisma.esportTeam.findFirst.mockResolvedValueOnce({ id: "manuelle", logoUrl: "https://moi.fr/logo.png" });

		await service.import("week-1", [1], ACTOR);

		expect(prisma.esportTeam.update).toHaveBeenCalledWith({
			where: { id: "manuelle" },
			data: { pandascoreId: 10, logoUrl: "https://moi.fr/logo.png" },
		});
	});

	// Reimporter met a jour au lieu de doublonner.
	it("met a jour un match deja importe", async () => {
		const { service, prisma } = makeService([raw(1, SAMEDI)]);
		prisma.esportMatch.findMany.mockResolvedValue([{ id: "local-1", pandascoreId: 1, finishedAt: null }]);

		await service.import("week-1", [1], ACTOR);

		expect(prisma.esportMatch.create).not.toHaveBeenCalled();
		expect(prisma.esportMatch.update).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "local-1" } }),
		);
	});

	it("accepte un match de la nuit du dimanche au lundi", async () => {
		// Lundi 19 octobre, 1 h a Paris.
		const { service, prisma } = makeService([raw(1, "2026-10-18T23:00:00Z")]);

		await service.import("week-1", [1], ACTOR);

		expect(prisma.esportMatch.create).toHaveBeenCalled();
	});

	it("refuse un match que PandaScore a deplace dans une autre semaine", async () => {
		// Lundi suivant, 7 h a Paris (0 h 30 serait encore la nuit du dimanche).
		const { service } = makeService([raw(1, "2026-10-19T05:00:00Z")]);

		await expect(service.import("week-1", [1], ACTOR)).rejects.toBeInstanceOf(BadRequestException);
	});
});

describe("EsportImportService.refresh", () => {
	it("refuse une actualisation trop rapprochee, sans appeler PandaScore", async () => {
		const fetchSpy = jest.spyOn(global, "fetch");
		const { service, prisma } = makeService([]);
		prisma.pandascoreFetch.findUnique.mockResolvedValue({
			leagueIds: [5223],
			fetchedAt: new Date(Date.now() - 30_000),
		});

		await expect(service.refresh("week-1")).rejects.toBeInstanceOf(BadRequestException);
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});
