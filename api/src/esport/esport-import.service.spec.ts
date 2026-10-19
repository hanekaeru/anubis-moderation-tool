import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { AppConfig } from "../config/configuration";
import type { PrismaService } from "../prisma/prisma.service";
import { EsportImportService } from "./esport-import.service";
import type { EsportService } from "./esport.service";
import type { LiquipediaRawMatch } from "./liquipedia.client";

const GUILD_ID = "1534550360180396132";
const ACTOR = { id: "app-1", permissions: [] } as unknown as AuthenticatedUser;
const WEEK = { id: "week-1", guildId: GUILD_ID, weekStart: new Date("2026-10-12T00:00:00Z") };

/** `scheduledAt` en ISO ; Liquipedia ecrit `AAAA-MM-JJ HH:MM:SS` en UTC. */
function raw(id: string, scheduledAt: string, overrides: Partial<LiquipediaRawMatch> = {}): LiquipediaRawMatch {
	return {
		match2id: id,
		date: scheduledAt.slice(0, 19).replace("T", " "),
		dateexact: 1,
		finished: 0,
		bestof: 5,
		parent: "Overwatch_Champions_Series/2026/EMEA/Stage_3",
		tickername: "OWCS EMEA Stage 3 - Regular Season",
		series: "Overwatch Champions Series",
		match2opponents: [
			{ type: "team", name: "Twisted Minds" },
			{ type: "team", name: "Team Risk" },
		],
		...overrides,
	};
}

function makeService(cache: LiquipediaRawMatch[], overrides: Record<string, any> = {}) {
	const fetchedAt = new Date("2026-10-18T20:00:00Z");
	const prisma: Record<string, any> = {
		esportConfig: { findUnique: jest.fn().mockResolvedValue(null) },
		liquipediaMatch: {
			findMany: jest.fn().mockResolvedValue(cache.map((data) => ({ id: data.match2id, data, fetchedAt }))),
			findUnique: jest.fn(),
		},
		liquipediaFetch: { findUnique: jest.fn().mockResolvedValue(null) },
		esportMatch: {
			findMany: jest.fn().mockResolvedValue([]),
			count: jest.fn().mockResolvedValue(0),
			create: jest.fn(),
			update: jest.fn(),
		},
		esportTeam: {
			findUnique: jest.fn().mockResolvedValue(null),
			findFirst: jest.fn().mockResolvedValue(null),
			create: jest.fn(({ data }) => Promise.resolve({ id: `team-${data.liquipediaName}` })),
			update: jest.fn(),
		},
		...overrides,
	};
	prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));

	const esport = {
		loadWeek: jest.fn().mockResolvedValue(WEEK),
		loadMatch: jest.fn(),
		findWeek: jest.fn().mockResolvedValue({ id: WEEK.id }),
		resynchroniser: jest.fn(),
		verifierTaille: jest.fn(),
	} as unknown as EsportService;
	const config = {
		get: () => ({ liquipedia: { apiKey: "cle-de-test", available: true } }),
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

	it("cree le match et ses equipes depuis le cache, sans rappeler Liquipedia", async () => {
		const fetchSpy = jest.spyOn(global, "fetch");
		const { service, prisma, esport } = makeService([raw("m1", SAMEDI)]);

		await service.import("week-1", ["m1"], ACTOR);

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(prisma.esportTeam.create).toHaveBeenCalledTimes(2);
		expect(prisma.esportMatch.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				weekId: "week-1",
				liquipediaId: "m1",
				liquipediaPage: "Overwatch_Champions_Series/2026/EMEA/Stage_3",
				teamAId: "team-Twisted Minds",
				teamBId: "team-Team Risk",
				// L'OWCS est notee BO5 chez Liquipedia, et se joue en FT3.
				format: "FIRST_TO",
				bestOf: 3,
				competition: "OWCS EMEA Stage 3 - Regular Season",
				region: "EMEA",
			}),
		});
		expect(esport.verifierTaille).toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("garde le BO5 quand le reglage « premier a » est coupe", async () => {
		const { service, prisma } = makeService([raw("m1", SAMEDI)]);
		prisma.esportConfig.findUnique.mockResolvedValue({
			liquipediaSeries: ["Overwatch Champions Series"],
			liquipediaKeywords: [],
			liquipediaFirstTo: false,
		});

		await service.import("week-1", ["m1"], ACTOR);

		expect(prisma.esportMatch.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ format: "BEST_OF", bestOf: 5 }),
		});
	});

	it("relie une equipe saisie a la main portant le meme nom", async () => {
		const { service, prisma } = makeService([raw("m1", SAMEDI)]);
		prisma.esportTeam.findFirst.mockResolvedValueOnce({ id: "manuelle", logoUrl: "https://moi.fr/logo.png" });

		await service.import("week-1", ["m1"], ACTOR);

		expect(prisma.esportTeam.update).toHaveBeenCalledWith({
			where: { id: "manuelle" },
			// Son logo saisi a la main n'est pas touche.
			data: { liquipediaName: "Twisted Minds" },
		});
	});

	// Reimporter met a jour au lieu de doublonner.
	it("met a jour un match deja importe", async () => {
		const { service, prisma } = makeService([raw("m1", SAMEDI)]);
		prisma.esportMatch.findMany.mockResolvedValue([{ id: "local-1", liquipediaId: "m1", finishedAt: null }]);

		await service.import("week-1", ["m1"], ACTOR);

		expect(prisma.esportMatch.create).not.toHaveBeenCalled();
		expect(prisma.esportMatch.update).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "local-1" } }),
		);
	});

	it("accepte un match de la nuit du dimanche au lundi", async () => {
		// Lundi 19 octobre, 1 h a Paris.
		const { service, prisma } = makeService([raw("m1", "2026-10-18T23:00:00Z")]);

		await service.import("week-1", ["m1"], ACTOR);

		expect(prisma.esportMatch.create).toHaveBeenCalled();
	});

	it("refuse un match que Liquipedia a deplace dans une autre semaine", async () => {
		// Lundi suivant, 7 h a Paris (0 h 30 serait encore la nuit du dimanche).
		const { service } = makeService([raw("m1", "2026-10-19T05:00:00Z")]);

		await expect(service.import("week-1", ["m1"], ACTOR)).rejects.toBeInstanceOf(BadRequestException);
	});
});

describe("EsportImportService.refresh", () => {
	it("refuse une actualisation trop rapprochee, sans appeler Liquipedia", async () => {
		const fetchSpy = jest.spyOn(global, "fetch");
		const { service, prisma } = makeService([]);
		prisma.liquipediaFetch.findUnique.mockResolvedValue({
			series: ["Overwatch Champions Series"],
			fetchedAt: new Date(Date.now() - 30_000),
		});

		await expect(service.refresh("week-1")).rejects.toBeInstanceOf(BadRequestException);
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});

describe("EsportImportService.fetchScores", () => {
	const SAMEDI = "2026-10-17T19:00:00Z";
	const FINI: Partial<LiquipediaRawMatch> = {
		finished: 1,
		match2opponents: [
			{ type: "team", name: "Twisted Minds", score: 3, status: "S" },
			{ type: "team", name: "Team Risk", score: 1, status: "S" },
		],
	};
	const RECENT = { series: ["Overwatch Champions Series"], fetchedAt: new Date(Date.now() - 30_000) };

	function local(overrides: Record<string, unknown> = {}) {
		return {
			id: "local-1",
			liquipediaId: "m1",
			finishedAt: null,
			scoreA: null,
			scoreB: null,
			suggestedScoreA: null,
			suggestedScoreB: null,
			suggestedForfeit: false,
			suggestedAt: null,
			teamA: { liquipediaName: "Twisted Minds" },
			teamB: { liquipediaName: "Team Risk" },
			...overrides,
		};
	}

	it("pose le score en proposition, sans terminer le match ni toucher au recapitulatif", async () => {
		const { service, prisma, esport } = makeService([raw("m1", SAMEDI, FINI)]);
		prisma.liquipediaFetch.findUnique.mockResolvedValue(RECENT);
		prisma.esportMatch.findMany.mockResolvedValue([local()]);

		const result = await service.fetchScores("week-1", ACTOR);

		expect(result).toMatchObject({ suggested: 1, refreshed: false });
		expect(prisma.esportMatch.update).toHaveBeenCalledWith({
			where: { id: "local-1" },
			data: expect.objectContaining({ suggestedScoreA: 3, suggestedScoreB: 1, suggestedForfeit: false }),
		});
		const data = prisma.esportMatch.update.mock.calls[0][0].data;
		expect(data).not.toHaveProperty("finishedAt");
		expect(data).not.toHaveProperty("scoreA");
		expect(esport.resynchroniser).not.toHaveBeenCalled();
	});

	it("remet le score dans l'ordre des equipes du dashboard", async () => {
		const { service, prisma } = makeService([raw("m1", SAMEDI, FINI)]);
		prisma.liquipediaFetch.findUnique.mockResolvedValue(RECENT);
		prisma.esportMatch.findMany.mockResolvedValue([
			local({ teamA: { liquipediaName: "Team Risk" }, teamB: { liquipediaName: "Twisted Minds" } }),
		]);

		await service.fetchScores("week-1", ACTOR);

		expect(prisma.esportMatch.update).toHaveBeenCalledWith({
			where: { id: "local-1" },
			data: expect.objectContaining({ suggestedScoreA: 1, suggestedScoreB: 3 }),
		});
	});

	it("ne propose rien pour un match deja termine sur ce score", async () => {
		const { service, prisma } = makeService([raw("m1", SAMEDI, FINI)]);
		prisma.liquipediaFetch.findUnique.mockResolvedValue(RECENT);
		prisma.esportMatch.findMany.mockResolvedValue([local({ finishedAt: new Date(), scoreA: 3, scoreB: 1 })]);

		const result = await service.fetchScores("week-1", ACTOR);

		expect(result.suggested).toBe(0);
		expect(prisma.esportMatch.update).not.toHaveBeenCalled();
	});

	it("retire une proposition devenue sans objet", async () => {
		const { service, prisma } = makeService([raw("m1", SAMEDI)]);
		prisma.liquipediaFetch.findUnique.mockResolvedValue(RECENT);
		prisma.esportMatch.findMany.mockResolvedValue([
			local({ suggestedScoreA: 3, suggestedScoreB: 1, suggestedAt: new Date() }),
		]);

		await service.fetchScores("week-1", ACTOR);

		expect(prisma.esportMatch.update).toHaveBeenCalledWith({
			where: { id: "local-1" },
			data: expect.objectContaining({ suggestedScoreA: null, suggestedAt: null }),
		});
	});

	it("se contente du cache quand il a moins de deux minutes", async () => {
		const fetchSpy = jest.spyOn(global, "fetch");
		const { service, prisma } = makeService([]);
		prisma.liquipediaFetch.findUnique.mockResolvedValue(RECENT);

		await expect(service.fetchScores("week-1", ACTOR)).resolves.toMatchObject({ refreshed: false });
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});
