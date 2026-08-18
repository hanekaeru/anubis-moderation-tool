const prismaMock = {
	ticket: {
		count: jest.fn().mockResolvedValue(0),
		updateMany: jest.fn().mockResolvedValue({ count: 1 }),
		findUnique: jest.fn().mockResolvedValue(null),
		findMany: jest.fn().mockResolvedValue([]),
	},
	ticketConfig: {
		findUnique: jest.fn().mockResolvedValue(null),
	},
	ticketEvent: {
		create: jest.fn().mockResolvedValue(undefined),
	},
	ticketSubject: {
		findMany: jest.fn().mockResolvedValue([]),
		findFirst: jest.fn().mockResolvedValue(null),
	},
	ticketModeratorPrefix: {
		findUnique: jest.fn().mockResolvedValue(null),
		upsert: jest.fn().mockResolvedValue(undefined),
	},
};

jest.mock("../prisma", () => ({ __esModule: true, default: prismaMock }));

import * as tickets from "./tickets";

const GUILD_ID = "guild-1";
const OPENER_ID = "user-1";

beforeEach(() => {
	jest.clearAllMocks();
	prismaMock.ticket.count.mockResolvedValue(0);
	prismaMock.ticketConfig.findUnique.mockResolvedValue(null);
	prismaMock.ticket.updateMany.mockResolvedValue({ count: 1 });
});

describe("openTicketQuota", () => {
	// L'absence de ligne `TicketConfig` ne vaut pas « aucune limite » : le
	// defaut doit reproduire le comportement d'avant le reglage, ou un seul
	// ticket ouvert etait tolere.
	it("retombe sur un seul ticket quand rien n'est configure", async () => {
		prismaMock.ticket.count.mockResolvedValue(1);

		const quota = await tickets.openTicketQuota(GUILD_ID, OPENER_ID);

		expect(quota.max).toBe(1);
		expect(quota.reached).toBe(true);
	});

	it("laisse ouvrir tant que la limite configuree n'est pas atteinte", async () => {
		prismaMock.ticketConfig.findUnique.mockResolvedValue({ maxOpenTickets: 3 });
		prismaMock.ticket.count.mockResolvedValue(2);

		const quota = await tickets.openTicketQuota(GUILD_ID, OPENER_ID);

		expect(quota).toEqual({ open: 2, max: 3, reached: false });
	});

	// Une limite abaissee depuis le dashboard ne doit pas fermer de ticket,
	// seulement empecher d'en ouvrir un de plus.
	it("considere la limite atteinte quand elle a ete abaissee sous le compte courant", async () => {
		prismaMock.ticketConfig.findUnique.mockResolvedValue({ maxOpenTickets: 2 });
		prismaMock.ticket.count.mockResolvedValue(4);

		const quota = await tickets.openTicketQuota(GUILD_ID, OPENER_ID);

		expect(quota.reached).toBe(true);
	});

	it("ne compte pas les tickets fermes", async () => {
		await tickets.openTicketQuota(GUILD_ID, OPENER_ID);

		expect(prismaMock.ticket.count).toHaveBeenCalledWith({
			where: {
				guildId: GUILD_ID,
				openerId: OPENER_ID,
				status: { not: "CLOSED" },
			},
		});
	});
});

describe("claimTicket", () => {
	// Deux moderateurs qui cliquent en meme temps ne doivent pas se voler le
	// ticket ni renommer le salon deux fois : Discord n'accepte que deux
	// renommages par tranche de dix minutes.
	it("ne prend le ticket que s'il n'a pas deja de preneur", async () => {
		await tickets.claimTicket("ticket-1", "mod-1");

		const [appel] = prismaMock.ticket.updateMany.mock.calls;
		expect(appel[0].where).toEqual({
			id: "ticket-1",
			claimedByDiscordId: null,
			claimedById: null,
		});
	});

	it("renvoie false et n'ecrit rien de plus quand le ticket est deja pris", async () => {
		prismaMock.ticket.updateMany.mockResolvedValue({ count: 0 });

		const pris = await tickets.claimTicket("ticket-1", "mod-2");

		expect(pris).toBe(false);
		expect(prismaMock.ticketEvent.create).not.toHaveBeenCalled();
		expect(prismaMock.ticket.updateMany).toHaveBeenCalledTimes(1);
	});

	// Prendre un ticket est le moment ou le staff s'en saisit : sans cela, le
	// delai de prise en charge du dashboard ne mesurerait rien tant que le
	// moderateur n'a pas ecrit.
	it("pose la premiere reponse si elle manquait", async () => {
		await tickets.claimTicket("ticket-1", "mod-1");

		const secondAppel = prismaMock.ticket.updateMany.mock.calls[1];
		expect(secondAppel[0].where).toEqual({
			id: "ticket-1",
			firstResponseAt: null,
		});
		expect(secondAppel[0].data.firstResponseAt).toBeInstanceOf(Date);
	});

	it("journalise la prise en charge comme venant de Discord", async () => {
		await tickets.claimTicket("ticket-1", "mod-1");

		expect(prismaMock.ticketEvent.create).toHaveBeenCalledWith({
			data: {
				ticketId: "ticket-1",
				type: "CLAIMED",
				actorId: "mod-1",
				payload: { source: "discord" },
			},
		});
	});
});
