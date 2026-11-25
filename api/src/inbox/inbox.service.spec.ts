import { Permission } from "@anubis/shared";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { InboxService } from "./inbox.service";

function actor(permissions: Permission[]): AuthenticatedUser {
	return { id: "app-1", permissions } as unknown as AuthenticatedUser;
}

function makeService() {
	const prisma: Record<string, any> = {
		sanction: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
		ticket: {
			count: jest.fn().mockResolvedValue(2),
			findMany: jest.fn().mockResolvedValue([
				{ id: "t1", number: 12, subject: "Signalement", openedAt: new Date("2026-11-24T10:00:00Z") },
			]),
		},
		accountFlag: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
		quarantineConfig: { findUnique: jest.fn().mockResolvedValue(null) },
		quarantineStatus: { count: jest.fn(), findMany: jest.fn() },
		esportMatch: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
		esportWeek: { findMany: jest.fn().mockResolvedValue([]) },
		embedMessage: { findMany: jest.fn().mockResolvedValue([]) },
		minigameEvent: { findMany: jest.fn().mockResolvedValue([]) },
		minigameConfig: { findUnique: jest.fn().mockResolvedValue({ guildId: "g1" }) },
	};
	const service = new InboxService(
		prisma as unknown as PrismaService,
		{ guildId: "g1" } as unknown as GuildContextService,
	);
	return { service, prisma };
}

describe("InboxService.forUser", () => {
	it("ne lit que les sections permises, et ne rend que les sections non vides", async () => {
		const { service, prisma } = makeService();

		const inbox = await service.forUser(actor([Permission.TICKETS_READ]));

		expect(inbox.sections.map((s) => s.key)).toEqual(["TICKETS"]);
		expect(inbox.total).toBe(2);
		expect(inbox.sections[0]!.items[0]).toEqual(
			expect.objectContaining({ label: "#12 — Signalement", link: "/tickets/t1" }),
		);
		expect(prisma.ticket.findMany.mock.calls[0][0].where).toEqual({
			guildId: "g1",
			status: "OPEN",
			firstResponseAt: null,
		});
		// Sections fermees a ce compte : rien n'est meme lu.
		expect(prisma.sanction.count).not.toHaveBeenCalled();
		expect(prisma.accountFlag.count).not.toHaveBeenCalled();
		expect(prisma.embedMessage.findMany).not.toHaveBeenCalled();
		expect(prisma.minigameEvent.findMany).not.toHaveBeenCalled();
	});

	it("compte les jours sans mini-jeu dans les sept prochains jours, heure de Paris", async () => {
		const { service, prisma } = makeService();
		// 22:30 UTC, soit 23:30 a Paris : encore le mardi 24 pour le calendrier.
		const now = new Date("2026-11-24T22:30:00Z");
		prisma.minigameEvent.findMany.mockResolvedValue([
			{ day: new Date("2026-11-24T00:00:00Z") },
			{ day: new Date("2026-11-26T00:00:00Z") },
		]);

		const inbox = await service.forUser(actor([Permission.MINIGAMES_WRITE]), now);

		const section = inbox.sections.find((s) => s.key === "MINIGAMES_PLANNING")!;
		expect(section.count).toBe(5);
		expect(section.items.map((i) => i.id)).toEqual([
			"2026-11-25",
			"2026-11-27",
			"2026-11-28",
			"2026-11-29",
			"2026-11-30",
		]);
	});

	it("tait le calendrier d'un serveur qui ne se sert pas des mini-jeux", async () => {
		const { service, prisma } = makeService();
		prisma.minigameConfig.findUnique.mockResolvedValue(null);

		const inbox = await service.forUser(actor([Permission.MINIGAMES_WRITE]));

		expect(inbox.sections).toEqual([]);
		expect(prisma.minigameEvent.findMany).not.toHaveBeenCalled();
	});
});
