import {
	claimedTicketChannelName,
	newTicketChannelName,
	slugifyChannelPart,
} from "./ticket";

describe("slugifyChannelPart", () => {
	// Discord met les noms de salon en minuscules et remplace ce qu'il ne
	// comprend pas : normaliser ici garde le nom stocke en base identique a
	// celui reellement affiche.
	it("retire accents, majuscules et caracteres refuses", () => {
		expect(slugifyChannelPart("Éric_Machin!")).toBe("eric-machin");
	});

	it("ne laisse jamais de tiret en bordure", () => {
		expect(slugifyChannelPart("...bob...")).toBe("bob");
	});

	it("rend une chaine vide pour un pseudo entierement fait d'emojis", () => {
		expect(slugifyChannelPart("🎮🎮")).toBe("");
	});
});

describe("claimedTicketChannelName", () => {
	it("compose prefixe, pseudo et numero", () => {
		expect(claimedTicketChannelName("hane", "machin", 1)).toBe("hane-machin-0001");
	});

	it("normalise le prefixe comme le pseudo", () => {
		expect(claimedTicketChannelName("Hané", "Grand Méchant", 42)).toBe(
			"hane-grand-mechant-0042",
		);
	});

	// Le prefixe designe le moderateur et le numero retrouve le ticket : seul
	// le pseudo peut etre raccourci sans perdre d'information.
	it("tronque le pseudo, jamais le prefixe ni le numero", () => {
		const nom = claimedTicketChannelName("hane", "x".repeat(60), 7);

		expect(nom.startsWith("hane-")).toBe(true);
		expect(nom.endsWith("-0007")).toBe(true);
		expect(nom.length).toBeLessThanOrEqual(100);
	});

	// Un pseudo qui ne survit pas a la normalisation laisserait sinon deux
	// tirets colles, que Discord afficherait tel quel.
	it("remplace un pseudo vide apres normalisation", () => {
		expect(claimedTicketChannelName("hane", "🎮🎮", 3)).toBe("hane-membre-0003");
	});
});

describe("newTicketChannelName", () => {
	it("garde le nommage numerote d'avant la prise en charge", () => {
		expect(newTicketChannelName(12)).toBe("ticket-0012");
	});
});
