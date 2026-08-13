import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import type { TicketQueryDto, UpdateTicketDto } from "./dto/ticket.dto";
import { TicketsService } from "./tickets.service";

const ACTOR: AuthenticatedUser = {
	id: "app-1",
	username: "mod",
	displayName: "Mod",
	role: "MODERATOR",
	permissions: [],
	mustChangePassword: false,
};

function ticketRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "ticket-1",
		guildId: "guild-1",
		number: 1,
		subject: "Probleme de connexion",
		category: "support",
		status: "OPEN",
		priority: "NORMAL",
		channelId: "chan-1",
		openerId: "250902879667879937",
		assigneeId: null,
		openedAt: new Date("2026-01-01T00:00:00.000Z"),
		closedAt: null,
		closeReason: null,
		messageCount: 0,
		firstResponseAt: null,
		rating: null,
		opener: { id: "250902879667879937", username: "member", globalName: null, avatarHash: null },
		assignee: null,
		claimedBy: null,
		closedBy: null,
		...overrides,
	};
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
	const prisma = {
		ticket: {
			findMany: jest.fn(),
			count: jest.fn(),
			findFirst: jest.fn().mockResolvedValue({ ...ticketRow(), events: [] }),
			groupBy: jest.fn(),
			...(prismaOverrides.ticket as object),
		},
		moderationActivity: { create: jest.fn().mockResolvedValue(undefined) },
		$transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
			const tx = {
				ticket: { update: jest.fn().mockResolvedValue(undefined) },
				ticketEvent: { createMany: jest.fn().mockResolvedValue(undefined) },
			};
			await fn(tx);
			return tx;
		}),
		...prismaOverrides,
	} as unknown as PrismaService;

	const guild = { guildId: "guild-1" } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return { service: new TicketsService(prisma, guild, audit), prisma, audit };
}

function query(overrides: Partial<TicketQueryDto> = {}): TicketQueryDto {
	return {
		page: 1,
		pageSize: 20,
		skip: 0,
		take: 20,
		sortBy: "priority",
		sortDir: "desc",
		...overrides,
	} as TicketQueryDto;
}

describe("TicketsService.search — tri par priorite", () => {
	it("trie du plus urgent au moins urgent quand sortDir = desc", async () => {
		const rows = [
			ticketRow({ id: "low", priority: "LOW" }),
			ticketRow({ id: "urgent", priority: "URGENT" }),
			ticketRow({ id: "normal", priority: "NORMAL" }),
			ticketRow({ id: "high", priority: "HIGH" }),
		];
		const { service } = makeService({
			ticket: {
				findMany: jest.fn().mockResolvedValue(rows),
				count: jest.fn().mockResolvedValue(rows.length),
				findFirst: jest.fn(),
				groupBy: jest.fn(),
			},
		});

		const result = await service.search(query({ sortDir: "desc" }));

		expect(result.items.map((t) => t.id)).toEqual(["urgent", "high", "normal", "low"]);
	});

	it("inverse l'ordre quand sortDir = asc", async () => {
		const rows = [
			ticketRow({ id: "urgent", priority: "URGENT" }),
			ticketRow({ id: "low", priority: "LOW" }),
		];
		const { service } = makeService({
			ticket: {
				findMany: jest.fn().mockResolvedValue(rows),
				count: jest.fn().mockResolvedValue(rows.length),
				findFirst: jest.fn(),
				groupBy: jest.fn(),
			},
		});

		const result = await service.search(query({ sortDir: "asc" }));

		expect(result.items.map((t) => t.id)).toEqual(["low", "urgent"]);
	});
});

describe("TicketsService.update", () => {
	function makeUpdateService(existing: Record<string, unknown>) {
		const txTicketUpdate = jest.fn().mockResolvedValue(undefined);
		const txEventCreateMany = jest.fn().mockResolvedValue(undefined);
		const prisma = {
			ticket: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce(existing)
					.mockResolvedValue({ ...ticketRow(existing), events: [] }),
				findMany: jest.fn(),
				count: jest.fn(),
				groupBy: jest.fn(),
			},
			moderationActivity: { create: jest.fn().mockResolvedValue(undefined) },
			$transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
				await fn({
					ticket: { update: txTicketUpdate },
					ticketEvent: { createMany: txEventCreateMany },
				});
			}),
		} as unknown as PrismaService;

		const guild = { guildId: "guild-1" } as unknown as GuildContextService;
		const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

		return {
			service: new TicketsService(prisma, guild, audit),
			txEventCreateMany,
			prisma,
		};
	}

	it("detecte une fermeture et cree un evenement CLOSED", async () => {
		const existing = ticketRow({ status: "OPEN" });
		const { service, txEventCreateMany } = makeUpdateService(existing);

		await service.update("ticket-1", { status: "CLOSED" } as UpdateTicketDto, ACTOR);

		expect(txEventCreateMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({ type: "CLOSED", payload: { from: "OPEN", to: "CLOSED" } }),
			],
		});
	});

	it("detecte une reouverture et cree un evenement REOPENED", async () => {
		const existing = ticketRow({ status: "CLOSED" });
		const { service, txEventCreateMany } = makeUpdateService(existing);

		await service.update("ticket-1", { status: "OPEN" } as UpdateTicketDto, ACTOR);

		expect(txEventCreateMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({ type: "REOPENED" }),
			],
		});
	});

	it("ne cree aucun evenement si rien ne change vraiment", async () => {
		const existing = ticketRow({ status: "OPEN", priority: "NORMAL" });
		const { service, txEventCreateMany } = makeUpdateService(existing);

		await service.update(
			"ticket-1",
			{ status: "OPEN", priority: "NORMAL" } as UpdateTicketDto,
			ACTOR,
		);

		expect(txEventCreateMany).not.toHaveBeenCalled();
	});

	it("cree un evenement PRIORITY_CHANGED uniquement si la priorite change vraiment", async () => {
		const existing = ticketRow({ priority: "NORMAL" });
		const { service, txEventCreateMany } = makeUpdateService(existing);

		await service.update("ticket-1", { priority: "HIGH" } as UpdateTicketDto, ACTOR);

		expect(txEventCreateMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({
					type: "PRIORITY_CHANGED",
					payload: { from: "NORMAL", to: "HIGH" },
				}),
			],
		});
	});
});
