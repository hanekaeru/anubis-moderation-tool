import {
	OWDLE_SUB_ROLE_ROLE,
	type OwdleHero,
	compareOwdleGuess,
	findOwdleTwins,
	owdleDayKey,
	owdleStreaks,
	owdleSubRolesOf,
	owdleXpForGuesses,
	pickOwdleHero,
	renderOwdleGuess,
	renderOwdleShareGrid,
	resolveOwdleHero,
	searchOwdleHeroes,
} from "./owdle";

/**
 * Quelques heros tels que la migration les a enregistres. Les heros vivent en
 * base : ces tests portent sur la regle, pas sur l'exactitude de la liste.
 */
const HEROES: OwdleHero[] = [
	{ key: "reinhardt", name: "Reinhardt", role: "TANK", subRole: "STALWART", species: "HUMAN", origin: "Allemagne", region: "EUROPE", affiliation: { key: "overwatch", label: "Overwatch" }, releaseYear: 2016 },
	{ key: "junker-queen", name: "Reine des Junkers", role: "TANK", subRole: "STALWART", species: "HUMAN", origin: "Australie", region: "OCEANIA", affiliation: { key: "junkers", label: "Junkers" }, releaseYear: 2022 },
	{ key: "ramattra", name: "Ramattra", role: "TANK", subRole: "STALWART", species: "OMNIC", origin: "Népal", region: "ASIA", affiliation: { key: "other", label: "Autre" }, releaseYear: 2022 },
	{ key: "ashe", name: "Ashe", role: "DAMAGE", subRole: "SHARPSHOOTER", species: "HUMAN", origin: "États-Unis", region: "AMERICAS", affiliation: { key: "other", label: "Autre" }, releaseYear: 2018 },
	{ key: "bastion", name: "Bastion", role: "DAMAGE", subRole: "SPECIALIST", species: "OMNIC", origin: "Inconnue", region: "UNKNOWN", affiliation: { key: "none", label: "Aucune" }, releaseYear: 2016 },
	{ key: "cassidy", name: "Cassidy", role: "DAMAGE", subRole: "SHARPSHOOTER", species: "HUMAN", origin: "États-Unis", region: "AMERICAS", affiliation: { key: "overwatch", label: "Overwatch" }, releaseYear: 2016 },
	{ key: "genji", name: "Genji", role: "DAMAGE", subRole: "FLANKER", species: "HUMAN", origin: "Japon", region: "ASIA", affiliation: { key: "yokai", label: "Yokai" }, releaseYear: 2016 },
	{ key: "hanzo", name: "Hanzo", role: "DAMAGE", subRole: "SHARPSHOOTER", species: "HUMAN", origin: "Japon", region: "ASIA", affiliation: { key: "yokai", label: "Yokai" }, releaseYear: 2016 },
	{ key: "reaper", name: "Faucheur", role: "DAMAGE", subRole: "FLANKER", species: "HUMAN", origin: "États-Unis", region: "AMERICAS", affiliation: { key: "talon", label: "La Griffe" }, releaseYear: 2016 },
	{ key: "sojourn", name: "Sojourn", role: "DAMAGE", subRole: "SHARPSHOOTER", species: "HUMAN", origin: "Canada", region: "AMERICAS", affiliation: { key: "overwatch", label: "Overwatch" }, releaseYear: 2022 },
	{ key: "soldier-76", name: "Soldat : 76", role: "DAMAGE", subRole: "SPECIALIST", species: "HUMAN", origin: "États-Unis", region: "AMERICAS", affiliation: { key: "none", label: "Aucune" }, releaseYear: 2016 },
	{ key: "tracer", name: "Tracer", role: "DAMAGE", subRole: "FLANKER", species: "HUMAN", origin: "Angleterre", region: "EUROPE", affiliation: { key: "overwatch", label: "Overwatch" }, releaseYear: 2016 },
	{ key: "ana", name: "Ana", role: "SUPPORT", subRole: "TACTICIAN", species: "HUMAN", origin: "Égypte", region: "AFRICA", affiliation: { key: "overwatch", label: "Overwatch" }, releaseYear: 2016 },
	{ key: "jetpack-cat", name: "Jetpack Cat", role: "SUPPORT", subRole: "TACTICIAN", species: "ANIMAL", origin: "Inconnue", region: "UNKNOWN", affiliation: { key: "overwatch", label: "Overwatch" }, releaseYear: 2026 },
	{ key: "kiriko", name: "Kiriko", role: "SUPPORT", subRole: "SURVIVOR", species: "HUMAN", origin: "Japon", region: "ASIA", affiliation: { key: "yokai", label: "Yokai" }, releaseYear: 2022 },
	{ key: "lucio", name: "Lúcio", role: "SUPPORT", subRole: "TACTICIAN", species: "HUMAN", origin: "Brésil", region: "AMERICAS", affiliation: { key: "overwatch", label: "Overwatch" }, releaseYear: 2016 },
];

const hero = (key: string) => {
	const found = HEROES.find((h) => h.key === key);
	if (!found) throw new Error(`Heros inconnu : ${key}`);
	return found;
};

describe("sous-roles", () => {
	it("rattache chaque sous-role a un seul role", () => {
		const tous = [...owdleSubRolesOf("TANK"), ...owdleSubRolesOf("DAMAGE"), ...owdleSubRolesOf("SUPPORT")];
		expect(new Set(tous).size).toBe(Object.keys(OWDLE_SUB_ROLE_ROLE).length);
		expect(owdleSubRolesOf("TANK")).toEqual(["BRUISER", "INITIATOR", "STALWART"]);
	});
});

describe("findOwdleTwins", () => {
	it("ne trouve rien dans une liste sans doublon", () => {
		expect(findOwdleTwins(HEROES)).toEqual([]);
	});

	it("signale deux heros aux memes valeurs", () => {
		// Genji et Hanzo etaient jumeaux avec le type d'arme ; le sous-role les
		// departage. Une fiche corrigee de travers doit se voir.
		const copie = { ...hero("genji"), key: "genji-bis", name: "Genji bis" };
		expect(findOwdleTwins([...HEROES, copie])).toEqual([["genji", "genji-bis"]]);
	});
});

describe("compareOwdleGuess", () => {
	it("reconnait le heros du jour", () => {
		const c = compareOwdleGuess(hero("tracer"), hero("tracer"));
		expect(c.solved).toBe(true);
		expect(renderOwdleShareGrid([c])).toBe("🟩🟩🟩🟩🟩🟩");
	});

	it("ne donne pas la victoire a un heros aux memes valeurs", () => {
		// Six cases vertes, mais ce n'est pas le heros du jour : la victoire se
		// lit sur l'identite, jamais sur les attributs.
		const copie = { ...hero("genji"), key: "genji-bis", name: "Genji bis" };
		const c = compareOwdleGuess(copie, hero("genji"));
		expect(renderOwdleShareGrid([c])).toBe("🟩🟩🟩🟩🟩🟩");
		expect(c.solved).toBe(false);
	});

	it("compare l'affiliation sur sa cle, pas sur son libelle", () => {
		// Un libelle renomme depuis le dashboard ne doit changer aucune case.
		const renomme = { ...hero("ana"), affiliation: { key: "overwatch", label: "Overwatch (ancienne)" } };
		expect(compareOwdleGuess(renomme, hero("tracer")).affiliation).toBe("EXACT");
	});

	it("compare le sous-role", () => {
		expect(compareOwdleGuess(hero("genji"), hero("tracer")).subRole).toBe("EXACT");
		expect(compareOwdleGuess(hero("genji"), hero("hanzo")).subRole).toBe("WRONG");
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

	it("colle chaque case a sa valeur, en deux lignes de trois", () => {
		// Ana contre Soldat : 76. Aucune colonne a aligner : la vue doit se lire
		// pareil sur un telephone, ou un en-tete d'icones se decalait.
		const vue = renderOwdleGuess(hero("ana"), compareOwdleGuess(hero("ana"), hero("soldier-76")));
		expect(vue.split("\n")).toEqual([
			"**Ana**",
			"🟥 Soutien · 🟥 Tactique · 🟩 Humain",
			"🟥 Égypte · 🟥 Overwatch · 🟩 2016",
		]);
	});

	it("raccourcit les sous-roles trop longs pour un ecran de telephone", () => {
		const vue = renderOwdleGuess(hero("tracer"), compareOwdleGuess(hero("tracer"), hero("tracer")));
		expect(vue.split("\n")[1]).toEqual("🟩 Dégâts · 🟩 Flancs · 🟩 Humain");
	});

	it("indique le sens de l'annee de sortie", () => {
		expect(compareOwdleGuess(hero("tracer"), hero("kiriko")).releaseYear).toBe("HIGHER");
		expect(compareOwdleGuess(hero("kiriko"), hero("tracer")).releaseYear).toBe("LOWER");
	});
});

describe("resolveOwdleHero", () => {
	it("accepte la cle comme un nom tape a la main", () => {
		expect(resolveOwdleHero(HEROES, "soldier-76")?.name).toBe("Soldat : 76");
		expect(resolveOwdleHero(HEROES, "soldat 76")?.key).toBe("soldier-76");
		expect(resolveOwdleHero(HEROES, "LUCIO")?.key).toBe("lucio");
		expect(resolveOwdleHero(HEROES, "personne")).toBeUndefined();
		expect(resolveOwdleHero(HEROES, "  ")).toBeUndefined();
	});

	it("ne trouve que dans la liste recue", () => {
		// Le bot ne lui passe que les heros actifs : un heros desactive ne doit
		// plus pouvoir etre propose, meme tape a la main.
		expect(resolveOwdleHero(HEROES.filter((h) => h.key !== "ana"), "Ana")).toBeUndefined();
	});
});

describe("searchOwdleHeroes", () => {
	it("propose d'abord les noms qui commencent par la saisie", () => {
		const noms = searchOwdleHeroes(HEROES, "re").map((h) => h.name);
		expect(noms.slice(0, 2)).toEqual(["Reine des Junkers", "Reinhardt"]);
	});

	it("respecte la limite demandee", () => {
		expect(searchOwdleHeroes(HEROES, "", 5).length).toBe(5);
	});
});

describe("pickOwdleHero", () => {
	// Les bornes de la liste, pas des heros nommes : ajouter un heros ne doit pas
	// casser ce test.
	const premier = HEROES[0]!;
	const dernier = HEROES[HEROES.length - 1]!;

	it("ecarte les heros recents", () => {
		const recents = HEROES.slice(1).map((h) => h.key);
		expect(pickOwdleHero(HEROES, recents, () => 0.99).key).toBe(premier.key);
	});

	it("retombe sur la liste entiere si tout est exclu", () => {
		const tous = HEROES.map((h) => h.key);
		expect(pickOwdleHero(HEROES, tous, () => 0).key).toBe(premier.key);
		expect(pickOwdleHero(HEROES, [], () => 0.9999999).key).toBe(dernier.key);
	});

	it("refuse une liste vide plutot que de tirer undefined", () => {
		expect(() => pickOwdleHero([], [])).toThrow();
	});
});

describe("owdleXpForGuesses", () => {
	const bareme = [100, 80, 60];

	it("lit le bareme par nombre d'essais", () => {
		expect(owdleXpForGuesses(bareme, 1)).toBe(100);
		expect(owdleXpForGuesses(bareme, 3)).toBe(60);
	});

	it("applique la derniere valeur au-dela de la liste", () => {
		expect(owdleXpForGuesses(bareme, 4)).toBe(60);
		expect(owdleXpForGuesses(bareme, 40)).toBe(60);
	});

	it("ne rapporte rien sans bareme", () => {
		expect(owdleXpForGuesses([], 1)).toBe(0);
		expect(owdleXpForGuesses(bareme, 0)).toBe(0);
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
