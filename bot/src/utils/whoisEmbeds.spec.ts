import { MAX_CHAMP, joindreDansLaLimite } from "./whoisEmbeds";

describe("joindreDansLaLimite", () => {
	it("joint tout quand ca tient", () => {
		expect(joindreDansLaLimite(["a", "b", "c"])).toBe("a b c");
		expect(joindreDansLaLimite(["a", "b"], "\n")).toBe("a\nb");
		expect(joindreDansLaLimite([])).toBe("");
	});

	it("ne depasse jamais la limite d'un champ d'embed, mention de suite comprise", () => {
		// Soixante roles : de quoi deborder les 1024 caracteres d'un champ.
		const roles = Array.from({ length: 60 }, (_, i) => `<@&${String(100000000000000000n + BigInt(i))}>`);
		const resultat = joindreDansLaLimite(roles);

		expect(resultat.length).toBeLessThanOrEqual(MAX_CHAMP);
		const affiches = resultat.split(" ").filter((p) => p.startsWith("<@&")).length;
		expect(resultat).toMatch(new RegExp(`… et ${roles.length - affiches} autres$`));
	});

	it("annonce seulement le reste quand le premier element ne tient pas", () => {
		expect(joindreDansLaLimite(["x".repeat(50), "y"], " ", 20)).toBe("… et 2 autres");
	});

	it("accorde au singulier", () => {
		expect(joindreDansLaLimite(["aa", "bb", "cccccccccccccccc"], " ", 20)).toBe("aa bb … et 1 autre");
	});
});
