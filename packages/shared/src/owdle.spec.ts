import {
	OWDLE_HEROES,
	compareOwdleGuess,
	findOwdleHero,
	owdleDayKey,
	owdleStreaks,
	pickOwdleHero,
	renderOwdleShareGrid,
	resolveOwdleHero,
	searchOwdleHeroes,
} from "./owdle";

const hero = (key: string) => {
	const found = findOwdleHero(key);
	if (!found) throw new Error(`Heros inconnu : ${key}`);
	return found;
};

describe("OWDLE_HEROES", () => {
	it("n'a ni cle ni nom en double", () => {
		expect(new Set(OWDLE_HEROES.map((h) => h.key)).size).toBe(OWDLE_HEROES.length);
		expect(new Set(OWDLE_HEROES.map((h) => h.name)).size).toBe(OWDLE_HEROES.length);
	});

	it("n'a aucun heros indiscernable d'un autre", () => {
		// Deux heros aux attributs identiques rendraient la partie injouable :
		// aucun essai ne permettrait de les departager.
		const signature = (h: (typeof OWDLE_HEROES)[number]) =>
			[h.role, h.species, h.origin, h.affiliation, h.releaseYear, h.weapon].join("|");
		const vus = new Map<string, string>();
		for (const h of OWDLE_HEROES) {
			expect([vus.get(signature(h)), h.key]).toEqual([undefined, h.key]);
			vus.set(signature(h), h.key);
		}
	});
});

describe("compareOwdleGuess", () => {
	it("reconnait le heros du jour", () => {
		const c = compareOwdleGuess(hero("tracer"), hero("tracer"));
		expect(c.solved).toBe(true);
		expect(renderOwdleShareGrid([c])).toBe("🟩🟩🟩🟩🟩🟩");
	});

	it("marque en partiel une origine du meme continent", () => {
		// Ashe (Etats-Unis) contre Sojourn (Canada) : meme continent.
		expect(compareOwdleGuess(hero("ashe"), hero("sojourn")).origin).toBe("PARTIAL");
		expect(compareOwdleGuess(hero("ashe"), hero("cassidy")).origin).toBe("EXACT");
		expect(compareOwdleGuess(hero("ashe"), hero("tracer")).origin).toBe("WRONG");
	});

	it("ne rapproche pas deux origines inconnues", () => {
		expect(compareOwdleGuess(hero("bastion"), hero("ramattra")).origin).toBe("EXACT");
		expect(compareOwdleGuess(hero("echo"), hero("dva")).origin).toBe("WRONG");
	});

	it("indique le sens de l'annee de sortie", () => {
		expect(compareOwdleGuess(hero("tracer"), hero("kiriko")).releaseYear).toBe("HIGHER");
		expect(compareOwdleGuess(hero("kiriko"), hero("tracer")).releaseYear).toBe("LOWER");
	});
});

describe("resolveOwdleHero", () => {
	it("accepte la cle comme un nom tape a la main", () => {
		expect(resolveOwdleHero("soldier-76")?.name).toBe("Soldat : 76");
		expect(resolveOwdleHero("soldat 76")?.key).toBe("soldier-76");
		expect(resolveOwdleHero("LUCIO")?.key).toBe("lucio");
		expect(resolveOwdleHero("personne")).toBeUndefined();
		expect(resolveOwdleHero("  ")).toBeUndefined();
	});
});

describe("searchOwdleHeroes", () => {
	it("propose d'abord les noms qui commencent par la saisie", () => {
		const noms = searchOwdleHeroes("re").map((h) => h.name);
		expect(noms.slice(0, 2)).toEqual(["Reine des Junkers", "Reinhardt"]);
	});

	it("respecte la limite de Discord", () => {
		expect(searchOwdleHeroes("").length).toBe(25);
	});
});

describe("pickOwdleHero", () => {
	const premier = hero("dva");
	const dernier = hero("zenyatta");

	it("ecarte les heros recents", () => {
		const recents = OWDLE_HEROES.slice(1).map((h) => h.key);
		expect(pickOwdleHero(recents, () => 0.99).key).toBe(premier.key);
	});

	it("retombe sur la liste entiere si tout est exclu", () => {
		const tous = OWDLE_HEROES.map((h) => h.key);
		expect(pickOwdleHero(tous, () => 0).key).toBe(premier.key);
		expect(pickOwdleHero([], () => 0.9999999).key).toBe(dernier.key);
	});
});

describe("owdleDayKey", () => {
	it("change de jour a minuit heure de Paris, pas en UTC", () => {
		// 23 h 30 UTC le 24 octobre = 1 h 30 le 25 a Paris (heure d'ete).
		expect(owdleDayKey(new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25");
	});
});

describe("owdleStreaks", () => {
	it("compte la serie en cours et la meilleure", () => {
		const jours = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-10", "2026-10-11"];
		expect(owdleStreaks(jours, "2026-10-11")).toEqual({ current: 2, best: 3 });
	});

	it("garde la serie tant que la journee n'est pas finie", () => {
		expect(owdleStreaks(["2026-10-10"], "2026-10-11").current).toBe(1);
		expect(owdleStreaks(["2026-10-10"], "2026-10-12").current).toBe(0);
	});

	it("traverse un changement de mois", () => {
		expect(owdleStreaks(["2026-10-31", "2026-11-01"], "2026-11-01")).toEqual({ current: 2, best: 2 });
	});

	it("ne compte rien sans victoire", () => {
		expect(owdleStreaks([], "2026-10-11")).toEqual({ current: 0, best: 0 });
	});
});
