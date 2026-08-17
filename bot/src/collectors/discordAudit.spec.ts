import { AuditLogEvent, PermissionFlagsBits } from "discord.js";
import type { Client, Guild, GuildAuditLogsEntry } from "discord.js";

const referentielMock = { upsertUser: jest.fn().mockResolvedValue(undefined) };
jest.mock("./referentiel", () => referentielMock);

import { chercherAction, garantirAuteur } from "./discordAudit";

function auditEntry(overrides: Record<string, unknown> = {}): GuildAuditLogsEntry {
	return {
		id: "entry-1",
		targetId: "target-1",
		executorId: "mod-1",
		executor: { tag: "mod#0001" },
		reason: null,
		createdTimestamp: Date.now(),
		createdAt: new Date(),
		changes: [],
		...overrides,
	} as unknown as GuildAuditLogsEntry;
}

function fakeGuild(
	entriesPerCall: GuildAuditLogsEntry[][],
	options: { hasPermission?: boolean; id?: string } = {},
): Guild {
	const fetchAuditLogs = jest.fn();
	for (const entries of entriesPerCall) {
		fetchAuditLogs.mockResolvedValueOnce({ entries: new Map(entries.map((e) => [e.id, e])) });
	}
	// Au-dela des reponses programmees, renvoyer une liste vide (tentatives epuisees).
	fetchAuditLogs.mockResolvedValue({ entries: new Map() });

	return {
		id: options.id ?? "guild-1",
		name: "Guild",
		members: {
			me: {
				permissions: { has: () => options.hasPermission ?? true },
			},
		},
		fetchAuditLogs,
	} as unknown as Guild;
}

beforeEach(() => {
	jest.clearAllMocks();
});

describe("chercherAction", () => {
	it("renvoie null immediatement sans permission 'Voir le journal d'audit'", async () => {
		const guild = fakeGuild([], { hasPermission: false, id: "guild-no-perm" });
		// L'avertissement de permission manquante est le comportement teste :
		// l'afficher ferait passer un cas nominal pour un incident en CI.
		const silence = jest.spyOn(console, "warn").mockImplementation(() => {});

		const result = await chercherAction(guild, AuditLogEvent.MemberKick, "target-1");

		silence.mockRestore();

		expect(result).toBeNull();
		expect((guild.fetchAuditLogs as jest.Mock)).not.toHaveBeenCalled();
	});

	it("renvoie l'entree correspondante des la premiere tentative", async () => {
		const entry = auditEntry({ id: "entry-first-try", targetId: "target-a" });
		const guild = fakeGuild([[entry]], { id: "guild-first-try" });

		const result = await chercherAction(guild, AuditLogEvent.MemberKick, "target-a");

		expect(result?.entryId).toBe("entry-first-try");
		expect(result?.executorId).toBe("mod-1");
		expect((guild.fetchAuditLogs as jest.Mock)).toHaveBeenCalledTimes(1);
	});

	it("ignore une entree hors de la fenetre de correspondance", async () => {
		const oldEntry = auditEntry({
			id: "entry-old",
			targetId: "target-b",
			createdTimestamp: Date.now() - 60_000,
		});
		const guild = fakeGuild([[oldEntry], [oldEntry], [oldEntry], [oldEntry]], {
			id: "guild-old-entry",
		});

		jest.useFakeTimers();
		const promise = chercherAction(guild, AuditLogEvent.MemberKick, "target-b");
		await jest.runAllTimersAsync();
		const result = await promise;
		jest.useRealTimers();

		expect(result).toBeNull();
		expect((guild.fetchAuditLogs as jest.Mock)).toHaveBeenCalledTimes(4);
	});

	it("epuise les tentatives quand le filtre `accepte` rejette toutes les entrees", async () => {
		const entry = auditEntry({ id: "entry-rejected", targetId: "target-c" });
		const guild = fakeGuild([[entry], [entry], [entry], [entry]], {
			id: "guild-rejected",
		});

		jest.useFakeTimers();
		const promise = chercherAction(
			guild,
			AuditLogEvent.MemberUpdate,
			"target-c",
			() => false,
		);
		await jest.runAllTimersAsync();
		const result = await promise;
		jest.useRealTimers();

		expect(result).toBeNull();
		expect((guild.fetchAuditLogs as jest.Mock)).toHaveBeenCalledTimes(4);
	});

	it("dedoublonne : une entree deja consommee n'est plus jamais renvoyee", async () => {
		const entry = auditEntry({ id: "entry-dedupe", targetId: "target-d" });
		const guildFirstCall = fakeGuild([[entry]], { id: "guild-dedupe" });

		const first = await chercherAction(guildFirstCall, AuditLogEvent.MemberKick, "target-d");
		expect(first?.entryId).toBe("entry-dedupe");

		const guildSecondCall = fakeGuild([[entry], [entry], [entry], [entry]], {
			id: "guild-dedupe",
		});
		jest.useFakeTimers();
		const promise = chercherAction(guildSecondCall, AuditLogEvent.MemberKick, "target-d");
		await jest.runAllTimersAsync();
		const second = await promise;
		jest.useRealTimers();

		expect(second).toBeNull();
	});
});

describe("garantirAuteur", () => {
	it("renvoie null sans appel reseau quand executorId est absent", async () => {
		const client = { users: { fetch: jest.fn() } } as unknown as Client;
		const result = await garantirAuteur(client, null);

		expect(result).toBeNull();
		expect((client.users.fetch as jest.Mock)).not.toHaveBeenCalled();
	});

	it("renvoie null quand l'utilisateur est introuvable", async () => {
		const client = {
			users: { fetch: jest.fn().mockRejectedValue(new Error("Unknown User")) },
		} as unknown as Client;

		const result = await garantirAuteur(client, "ghost-1");
		expect(result).toBeNull();
	});

	it("enregistre l'utilisateur en base puis renvoie son identifiant", async () => {
		const user = { id: "mod-42" };
		const client = {
			users: { fetch: jest.fn().mockResolvedValue(user) },
		} as unknown as Client;

		const result = await garantirAuteur(client, "mod-42");

		expect(result).toBe("mod-42");
		expect(referentielMock.upsertUser).toHaveBeenCalledWith(user);
	});
});

// Sanity check : la permission verifiee est bien celle du journal d'audit.
describe("PermissionFlagsBits.ViewAuditLog", () => {
	it("existe dans discord.js", () => {
		expect(PermissionFlagsBits.ViewAuditLog).toBeDefined();
	});
});
