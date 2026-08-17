import { parseCompactDelay } from "./duration";

describe("parseCompactDelay", () => {
	it("lit une unite simple", () => {
		expect(parseCompactDelay("2h")).toBe(7200);
		expect(parseCompactDelay("45m")).toBe(2700);
		expect(parseCompactDelay("30s")).toBe(30);
		expect(parseCompactDelay("3j")).toBe(3 * 86400);
	});

	it("accepte `d` comme `j`, pour une habitude anglophone", () => {
		expect(parseCompactDelay("2d")).toBe(parseCompactDelay("2j"));
	});

	it("combine plusieurs unites", () => {
		expect(parseCompactDelay("1h30m")).toBe(5400);
		expect(parseCompactDelay("1j2h")).toBe(86400 + 7200);
	});

	it("lit `1h30` comme une heure et demie", () => {
		// Le reliquat sans unite prend le cran sous le precedent : c'est ainsi
		// qu'on ecrit une duree a la main.
		expect(parseCompactDelay("1h30")).toBe(5400);
		expect(parseCompactDelay("2j12")).toBe(2 * 86400 + 12 * 3600);
	});

	it("ignore les espaces et la casse", () => {
		expect(parseCompactDelay("  2 H 30 M ")).toBe(9000);
	});

	it("refuse ce qu'il ne comprend pas entierement", () => {
		// Accepter une saisie a moitie lue poserait le rappel a une heure
		// inattendue, ce qui est pire que de refuser.
		for (const mauvais of ["", "demain", "2", "2x", "h2", "2h plus tard", "-3h"]) {
			expect(parseCompactDelay(mauvais)).toBeNull();
		}
	});

	it("refuse une duree nulle", () => {
		expect(parseCompactDelay("0h")).toBeNull();
	});
});
