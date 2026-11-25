import type { Message } from "discord.js";

jest.mock("../prisma", () => ({ __esModule: true, default: {} }));

import {
	DELAI_ENTRE_SIGNALEMENTS,
	capturer,
	marquerSignale,
	modaleDeSignalement,
	oublierTout,
	refusDeSignalement,
	reprendre,
} from "./reports";

const MESSAGE = { id: "m1", authorId: "auteur", authorIsSelf: false };

function faux(): Message<true> {
	return {
		guildId: "g1",
		channelId: "c1",
		id: "m1",
		url: "https://discord.com/channels/g1/c1/m1",
		content: "texte",
		createdAt: new Date("2026-11-25T10:00:00Z"),
		author: { id: "auteur" },
		webhookId: null,
		attachments: new Map([
			["a1", { name: "img.png", url: "https://cdn/img.png", contentType: "image/png", spoiler: true }],
		]),
	} as unknown as Message<true>;
}

beforeEach(() => oublierTout());

describe("refusDeSignalement", () => {
	it("refuse son propre message et ceux du bot", () => {
		expect(refusDeSignalement("auteur", MESSAGE, 0)).toBe("propre-message");
		expect(refusDeSignalement("x", { ...MESSAGE, authorIsSelf: true }, 0)).toBe("message-du-bot");
		expect(refusDeSignalement("x", MESSAGE, 0)).toBeNull();
	});

	it("refuse un second signalement du meme message, puis impose un delai entre deux", () => {
		const t0 = Date.now();
		const capture = reprendre(capturer(faux(), "x"))!;
		marquerSignale(capture, t0);

		expect(refusDeSignalement("x", MESSAGE, t0 + 1000)).toBe("deja-signale");
		expect(refusDeSignalement("x", { ...MESSAGE, id: "m2" }, t0 + 1000)).toBe("trop-tot");
		expect(refusDeSignalement("x", { ...MESSAGE, id: "m2" }, t0 + DELAI_ENTRE_SIGNALEMENTS + 1)).toBeNull();
		// Une autre personne peut signaler le meme message.
		expect(refusDeSignalement("y", MESSAGE, t0 + 1000)).toBeNull();
	});
});

describe("capturer / reprendre", () => {
	it("garde le message tel qu'au clic, une seule fois", () => {
		const cle = capturer(faux(), "x");
		const capture = reprendre(cle);
		expect(capture).toEqual(
			expect.objectContaining({
				content: "texte",
				authorId: "auteur",
				reporterId: "x",
				webhook: false,
				attachments: [{ name: "img.png", url: "https://cdn/img.png", image: true, spoiler: true }],
			}),
		);
		expect(reprendre(cle)).toBeNull();
	});
});

describe("modaleDeSignalement", () => {
	// Les builders de discord.js ne valident les limites de Discord qu'a
	// l'execution : construire la modale ici, c'est ce qui aurait attrape le
	// libelle de 49 caracteres avant la production.
	it("respecte les limites de Discord", () => {
		const json = modaleDeSignalement("00000000-0000-4000-8000-000000000000").toJSON();
		expect(json.title.length).toBeLessThanOrEqual(45);
		expect(json.custom_id.length).toBeLessThanOrEqual(100);
	});
});
