import {
	OWDLE_COLUMN_HEADER,
	OWDLE_HEROES,
	compareOwdleGuess,
	findOwdleHero,
	owdleDayKey,
	owdleStreaks,
	pickOwdleHero,
	renderOwdleGuessLine,
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

	it("n'a de heros indiscernables que les jumeaux declares", () => {
		// Des jumeaux restent jouables — une ligne toute verte qui n'est pas le
		// heros du jour coute un essai, et il ne reste que l'autre. La liste
		// existe pour qu'une faute de frappe ne fabrique pas une paire en silence.
		const JUMEAUX = [["genji", "hanzo"]];
		const signature = (h: (typeof OWDLE_HEROES)[number]) =>
			[h.role, h.species, h.origin, h.affiliation, h.releaseYear, h.weapon].join("|");
		const groupes = new Map<string, string[]>();
		for (const h of OWDLE_HEROES) {
			groupes.set(signature(h), [...(groupes.get(signature(h)) ?? []), h.key]);
		}
		expect([...groupes.values()].filter((keys) => keys.length > 1)).toEqual(JUMEAUX);
	});
});

describe("compareOwdleGuess", () => {
	it("reconnait le heros du jour", () => {
		const c = compareOwdleGuess(hero("tracer"), hero("tracer"));
		expect(c.solved).toBe(true);
		expect(renderOwdleShareGrid([c])).toBe("🟩🟩🟩🟩🟩🟩");
	});

	it("ne donne pas la victoire a un jumeau", () => {
		// Six cases vertes, mais ce n'est pas le heros du jour : la victoire se
		// lit sur l'identite, jamais sur les attributs.
		const c = compareOwdleGuess(hero("genji"), hero("hanzo"));
		expect(renderOwdleShareGrid([c])).toBe("🟩🟩🟩🟩🟩🟩");
		expect(c.solved).toBe(false);
	});

	it("marque en partiel une origine du meme continent", () => {
		// Ashe (Etats-Unis) contre Sojourn (Canada) : meme continent.
		expect(compareOwdleGuess(hero("ashe"), hero("sojourn")).origin).toBe("PARTIAL");
		expect(compareOwdleGuess(hero("ashe"), hero("cassidy")).origin).toBe("EXACT");
		expect(compareOwdleGuess(hero("ashe"), hero("tracer")).origin).toBe("WRONG");
	});

	it("ne rapproche pas deux origines inconnues", () => {
		expect(compareOwdleGuess(hero("bastion"), hero("jetpack-cat")).origin).toBe("EXACT");
		expect(compareOwdleGuess(hero("bastion"), hero("ramattra")).origin).toBe("WRONG");
	});

	it("ouvre la ligne d'essai par les cases, quelle que soit la longueur du nom", () => {
		// Ana contre Soldat : 76 — la ligne doit commencer par les six cases,
		// alignees sous l'en-tete, et garder les valeurs dans l'ordre des colonnes.
		const ligne = renderOwdleGuessLine(hero("ana"), compareOwdleGuess(hero("ana"), hero("soldier-76")));
		expect(ligne.split("\n")).toEqual([
			"🟥🟩🟥🟥🟩🟥 **Ana**",
			"-# Soutien · Humain · Égypte · Overwatch · 2016 · Projectile",
		]);
		expect(OWDLE_COLUMN_HEADER).toBe("🎭🧬🌍🚩📅🎯");
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
	// Les bornes de la liste, pas des heros nommes : ajouter un heros ne doit pas
	// casser ce test.
	const premier = OWDLE_HEROES[0]!;
	const dernier = OWDLE_HEROES[OWDLE_HEROES.length - 1]!;

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
