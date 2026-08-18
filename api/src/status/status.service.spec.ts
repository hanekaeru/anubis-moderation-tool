import type { GuildContextService } from "../common/guild-context.service";
import type { PrismaService } from "../prisma/prisma.service";
import { StatusService } from "./status.service";

// const GUILD_ID = "1534867404755177634";
const GUILD_ID = "1534550360180396132";

interface Options {
	heartbeat?: {
		startedAt: Date;
		lastHeartbeatAt: Date;
		wsPingMs: number | null;
		avgPingMs: number | null;
		guildCount: number;
	} | null;
	databaseUp?: boolean;
	activeLockdown?: boolean;
	automodIncidents?: number;
}

function makeService({
	heartbeat = null,
	databaseUp = true,
	activeLockdown = false,
	automodIncidents = 0,
}: Options = {}) {
	const prisma = {
		botHeartbeat: { findUnique: jest.fn().mockResolvedValue(heartbeat) },
		raidIncident: {
			findFirst: jest.fn().mockResolvedValue(activeLockdown ? { id: "x" } : null),
		},
		automodIncident: { count: jest.fn().mockResolvedValue(automodIncidents) },
		$queryRaw: databaseUp
			? jest.fn().mockResolvedValue([{ "?column?": 1 }])
			: jest.fn().mockRejectedValue(new Error("DB down")),
	} as unknown as PrismaService;

	const guild = { guildId: GUILD_ID } as unknown as GuildContextService;

	return new StatusService(prisma, guild);
}

/** Battement recent : le bot est vu en ligne. */
function freshHeartbeat(overrides: Partial<Options["heartbeat"] & object> = {}) {
	const now = Date.now();
	return {
		startedAt: new Date(now - 3600_000),
		lastHeartbeatAt: new Date(now - 1_000),
		wsPingMs: 50,
		avgPingMs: 48,
		guildCount: 1,
		...overrides,
	};
}

describe("StatusService.getStatus", () => {
	it("signale un incident critique quand le bot n'a jamais ecrit de battement", async () => {
		const status = await makeService({ heartbeat: null }).getStatus();

		expect(status.bot).toBeNull();
		expect(status.problems).toEqual([
			expect.objectContaining({ severity: "critical" }),
		]);
	});

	it("considere le bot en ligne quand le battement est recent", async () => {
		const status = await makeService({ heartbeat: freshHeartbeat() }).getStatus();

		expect(status.bot?.online).toBe(true);
		expect(status.problems).toEqual([]);
	});

	it("considere le bot hors ligne au-dela du seuil de battement", async () => {
		const now = Date.now();
		const status = await makeService({
			heartbeat: freshHeartbeat({ lastHeartbeatAt: new Date(now - 60_000) }),
		}).getStatus();

		expect(status.bot?.online).toBe(false);
		expect(status.problems).toContainEqual(
			expect.objectContaining({ severity: "critical" }),
		);
	});

	it("fige l'uptime au dernier battement quand le bot est hors ligne", async () => {
		const now = Date.now();
		// Demarre il y a 1h, dernier signe de vie il y a 10 min : le process n'a
		// tourne que 50 min, pas 60 — compter jusqu'a maintenant gonflerait la
		// duree de fonctionnement d'un process arrete.
		const status = await makeService({
			heartbeat: freshHeartbeat({
				startedAt: new Date(now - 3600_000),
				lastHeartbeatAt: new Date(now - 600_000),
			}),
		}).getStatus();

		expect(status.bot?.online).toBe(false);
		expect(status.bot?.uptimeSeconds).toBeGreaterThanOrEqual(2_980);
		expect(status.bot?.uptimeSeconds).toBeLessThanOrEqual(3_020);
	});

	it("signale une latence Discord elevee sans declarer d'incident", async () => {
		const status = await makeService({
			heartbeat: freshHeartbeat({ avgPingMs: 400 }),
		}).getStatus();

		expect(status.bot?.online).toBe(true);
		expect(status.problems).toEqual([
			expect.objectContaining({ severity: "warning" }),
		]);
	});

	it("remonte une base injoignable sans faire echouer la reponse", async () => {
		const status = await makeService({
			heartbeat: freshHeartbeat(),
			databaseUp: false,
		}).getStatus();

		expect(status.api.database).toEqual({ reachable: false, latencyMs: null });
		expect(status.problems).toContainEqual(
			expect.objectContaining({ severity: "critical" }),
		);
	});

	it("remonte un confinement anti-raid actif comme avertissement", async () => {
		const status = await makeService({
			heartbeat: freshHeartbeat(),
			activeLockdown: true,
			automodIncidents: 7,
		}).getStatus();

		expect(status.activeRaidLockdown).toBe(true);
		expect(status.automodIncidents24h).toBe(7);
		expect(status.problems).toEqual([
			expect.objectContaining({ severity: "warning" }),
		]);
	});
});
