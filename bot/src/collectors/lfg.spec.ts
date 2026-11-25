import { placesCherchees } from "./lfg";

describe("placesCherchees", () => {
	it("ne garde que les roles recherches, dans l'ordre tank, dps, support", () => {
		expect(placesCherchees({ tank: 1, dps: 0, support: 2 })).toBe("🛡️ 1 · 💉 2");
	});

	it("rend null quand on ne cherche personne", () => {
		expect(placesCherchees({ tank: 0, dps: 0, support: 0 })).toBeNull();
	});
});
