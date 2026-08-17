import type { Message, OmitPartialGroupDMChannel, PartialMessage } from "discord.js";

const prismaMock = {
	messageStat: { upsert: jest.fn().mockResolvedValue(undefined) },
	memberActivityProfile: { upsert: jest.fn().mockResolvedValue(undefined) },
	$transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
};

jest.mock("../prisma", () => ({ __esModule: true, default: prismaMock }));

import collecteurActivite from "./activite";

function fakeMessage(overrides: Record<string, unknown> = {}): Message<true> {
	return {
		guild: { id: "guild-1" },
		author: { id: "user-1" },
		channel: { id: "chan-1" },
		createdAt: new Date("2026-08-10T15:30:00.000Z"), // lundi
		attachments: { size: 0 },
		content: "salut",
		...overrides,
	} as unknown as Message<true>;
}

// Chaque vidage journalise son bilan : utile en production, pur bruit dans le
// journal de CI, ou il noie ce qui compte vraiment.
let silence: jest.SpyInstance;

beforeEach(() => {
	jest.clearAllMocks();
	silence = jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	silence.mockRestore();
});

describe("enregistrerMessage", () => {
	it("aligne le jour de semaine sur lundi = 0 (UTC), pas dimanche = 0 comme JS natif", async () => {
		// 2026-08-10 est un lundi UTC.
		collecteurActivite.enregistrerMessage(fakeMessage());
		await collecteurActivite.vider();

		const [profileUpsertCall] = prismaMock.memberActivityProfile.upsert.mock.calls;
		expect(profileUpsertCall[0].create.weekday).toBe(0);
		expect(profileUpsertCall[0].create.hour).toBe(15);
	});

	it("agrege plusieurs messages du meme jour et salon avant le flush", async () => {
		collecteurActivite.enregistrerMessage(fakeMessage({ attachments: { size: 2 } }));
		collecteurActivite.enregistrerMessage(fakeMessage({ content: "re" }));
		await collecteurActivite.vider();

		const [statUpsertCall] = prismaMock.messageStat.upsert.mock.calls;
		expect(statUpsertCall[0].create.messageCount).toBe(2);
		expect(statUpsertCall[0].create.attachmentCount).toBe(2);
	});
});

describe("enregistrerEdition / enregistrerSuppression", () => {
	it("ignore un message partiel sans guild ou sans auteur", async () => {
		const partial = { guild: null, author: null } as unknown as OmitPartialGroupDMChannel<
			Message | PartialMessage
		>;

		collecteurActivite.enregistrerEdition(partial);
		collecteurActivite.enregistrerSuppression(partial);
		await collecteurActivite.vider();

		expect(prismaMock.messageStat.upsert).not.toHaveBeenCalled();
		expect(prismaMock.$transaction).not.toHaveBeenCalled();
	});
});

describe("vider", () => {
	it("vide le buffer apres un flush reussi (un second vider() ne reecrit rien)", async () => {
		collecteurActivite.enregistrerMessage(fakeMessage());
		await collecteurActivite.vider();
		expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

		await collecteurActivite.vider();
		expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
	});

	it("restaure le buffer quand la transaction echoue, puis le flush suivant contient la somme", async () => {
		prismaMock.$transaction.mockRejectedValueOnce(new Error("DB down"));
		const silent = jest.spyOn(console, "error").mockImplementation(() => {});

		collecteurActivite.enregistrerMessage(fakeMessage());
		await collecteurActivite.vider();

		collecteurActivite.enregistrerMessage(fakeMessage({ content: "encore" }));
		await collecteurActivite.vider();

		// Deux appels : le premier (echoue) avec messageCount=1, le second (reussi)
		// doit contenir la somme restauree.
		const calls = prismaMock.messageStat.upsert.mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[1][0].create.messageCount).toBe(2);

		silent.mockRestore();
	});
});
