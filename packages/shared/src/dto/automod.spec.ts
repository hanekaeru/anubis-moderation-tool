import {
	MAX_WORD_FILTER_PATTERN_LENGTH,
	validateWordFilterPatterns,
} from "./automod";

describe("validateWordFilterPatterns", () => {
	it("accepte une expression ordinaire", () => {
		expect(validateWordFilterPatterns(["c[o0]nn?ard", "\\bidiot\\b"])).toEqual([]);
	});

	it("refuse une expression qui ne compile pas", () => {
		const [issue] = validateWordFilterPatterns(["(non ferme"]);
		expect(issue?.reason).toMatch(/invalide/);
	});

	it("refuse un quantificateur imbrique", () => {
		// `(a+)+` sur une chaine qui ne correspond pas part en retour arriere
		// exponentiel : le bot n'a aucun moyen de l'interrompre.
		for (const dangereux of ["(a+)+", "(a*)*", "(\\d+)+$", "([a-z]+)*"]) {
			const [issue] = validateWordFilterPatterns([dangereux]);
			expect(issue?.reason).toMatch(/quantificateur imbriqué/);
		}
	});

	it("refuse une expression trop longue", () => {
		const [issue] = validateWordFilterPatterns([
			"a".repeat(MAX_WORD_FILTER_PATTERN_LENGTH + 1),
		]);
		expect(issue?.reason).toMatch(/caractères/);
	});

	it("signale chaque expression fautive, pas seulement la premiere", () => {
		const issues = validateWordFilterPatterns(["(a+)+", "bon", "(pas ferme"]);
		expect(issues.length).toBe(2);
	});

	it("laisse passer un groupe quantifie sans quantificateur interne", () => {
		// `(abc)+` est sans danger : c'est l'imbrication qui explose.
		expect(validateWordFilterPatterns(["(abc)+"])).toEqual([]);
	});
});
