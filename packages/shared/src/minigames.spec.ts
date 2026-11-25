import {
	isMinigameDayLocked,
	judgeSkinGuess,
	matchesMinigameText,
	minigameDayEnd,
	minigameDayKey,
	minigameDayStart,
	minigameEventProblem,
	minigamePollHours,
	minigameXpDelta,
	parseMinigameWeek,
	renderMinigameEndAnnouncement,
} from "./minigames";

describe("minigameXpDelta — meilleur des deux", () => {
	const bareme = [100, 60, 30];

	it("verse le palier entier pour une reponse complete", () => {
		expect(minigameXpDelta(bareme, 1, 1, 0)).toBe(100);
		expect(minigameXpDelta(bareme, 3, 1, 0)).toBe(30);
	});

	it("verse la moitie pour le heros seul", () => {
		expect(minigameXpDelta(bareme, 1, 0.5, 0)).toBe(50);
	});

	it("ne verse que l'ecart quand le skin suit le heros", () => {
		// Heros au 1er essai (50), skin au 2e : 60 au total, donc +10.
		expect(minigameXpDelta(bareme, 2, 1, 50)).toBe(10);
	});

	it("ne verse rien quand le skin rapporte moins que le heros deja paye", () => {
		expect(minigameXpDelta(bareme, 3, 1, 50)).toBe(0);
	});

	it("applique la derniere valeur au-dela du bareme", () => {
		expect(minigameXpDelta(bareme, 7, 1, 0)).toBe(30);
	});
});

describe("matchesMinigameText", () => {
	it("ignore casse, accents et ponctuation", () => {
		expect(matchesMinigameText("rat de calé", "Rat de cale")).toBe(true);
		expect(matchesMinigameText("RAT-DE-CALE !", "Rat de cale")).toBe(true);
	});

	it("tolere une faute sur un nom moyen, pas sur un nom court", () => {
		expect(matchesMinigameText("rat de calle", "Rat de cale")).toBe(true);
		expect(matchesMinigameText("ane", "Ana")).toBe(false);
		expect(matchesMinigameText("ana", "Ana")).toBe(true);
	});

	it("accepte les espaces mal places", () => {
		expect(matchesMinigameText("ratdecale", "Rat de cale")).toBe(true);
	});

	it("refuse une autre reponse", () => {
		expect(matchesMinigameText("pirate", "Rat de cale")).toBe(false);
	});
});

describe("judgeSkinGuess", () => {
	const heros = ["Chacal", "chacal"];

	it("reconnait le skin seul", () => {
		expect(judgeSkinGuess("rat de cale", "Rat de cale", heros)).toBe("SKIN");
	});

	it("reconnait le skin accompagne du heros, dans les deux ordres", () => {
		expect(judgeSkinGuess("Rat de cale - Chacal", "Rat de cale", heros)).toBe("SKIN");
		expect(judgeSkinGuess("chacal rat de cale", "Rat de cale", heros)).toBe("SKIN");
	});

	it("reconnait le heros seul", () => {
		expect(judgeSkinGuess("Chacal", "Rat de cale", heros)).toBe("HERO");
		expect(judgeSkinGuess("pirate - chacal", "Rat de cale", heros)).toBe("HERO");
	});

	it("refuse le reste", () => {
		expect(judgeSkinGuess("Chopper", "Rat de cale", heros)).toBe("WRONG");
		expect(judgeSkinGuess("   ", "Rat de cale", heros)).toBe("WRONG");
	});
});

describe("calendrier", () => {
	it("verrouille le jour meme et le passe, pas le lendemain", () => {
		// 15 janvier, 23 h 30 a Paris (22 h 30 UTC).
		const now = new Date("2027-01-15T22:30:00Z");
		expect(minigameDayKey(now)).toBe("2027-01-15");
		expect(isMinigameDayLocked("2027-01-16", now)).toBe(false);
		expect(isMinigameDayLocked("2027-01-15", now)).toBe(true);
		expect(isMinigameDayLocked("2027-01-14", now)).toBe(true);
	});

	it("verrouille le lendemain des minuit", () => {
		const minuit = new Date("2027-01-15T23:00:00Z"); // 16 janvier 00:00 a Paris
		expect(isMinigameDayLocked("2027-01-16", minuit)).toBe(true);
	});

	it("ouvre et ferme a minuit, heure de Paris, changement d'heure compris", () => {
		expect(minigameDayStart("2027-01-16").toISOString()).toBe("2027-01-15T23:00:00.000Z");
		expect(minigameDayEnd("2027-01-16").toISOString()).toBe("2027-01-16T23:00:00.000Z");
		// Nuit du passage a l'heure d'ete : la journee ne dure que 23 heures.
		expect(minigameDayEnd("2027-03-28").toISOString()).toBe("2027-03-28T22:00:00.000Z");
	});

	it("donne au sondage une duree entiere qui couvre le jeu", () => {
		const debut = minigameDayStart("2027-01-16");
		expect(minigamePollHours(debut, minigameDayEnd("2027-01-16"))).toBe(24);
		expect(minigamePollHours(new Date(debut.getTime() + 10.5 * 3_600_000), minigameDayEnd("2027-01-16"))).toBe(14);
		expect(minigamePollHours(minigameDayEnd("2027-01-16"), minigameDayEnd("2027-01-16"))).toBe(1);
	});

	it("lit une semaine type abimee sans echouer", () => {
		expect(parseMinigameWeek(["CLIP", "INCONNU"])).toEqual(["CLIP", null, null, null, null, null, null]);
		expect(parseMinigameWeek(null).length).toBe(7);
	});
});

describe("minigameEventProblem", () => {
	it("exige la reponse propre a chaque type", () => {
		expect(minigameEventProblem({ type: "GUESS_HERO", title: "Qui ?" })).toContain("héros");
		expect(minigameEventProblem({ type: "GUESS_SKIN", title: "Qui ?", answerSkin: "Rat de cale" })).toContain("héros");
		expect(minigameEventProblem({ type: "TRUE_FALSE", title: "Patch", answerTrue: false })).toBeNull();
		expect(minigameEventProblem({ type: "CLIP", title: "Clip" })).toBeNull();
	});

	it("exige deux reponses distinctes au duel", () => {
		expect(minigameEventProblem({ type: "DUEL", title: "Duel", pollAnswers: ["Ana"] })).not.toBeNull();
		expect(minigameEventProblem({ type: "DUEL", title: "Duel", pollAnswers: ["Ana", "ana"] })).not.toBeNull();
		expect(minigameEventProblem({ type: "DUEL", title: "Duel", pollAnswers: ["Ana", "Kiriko"] })).toBeNull();
	});

	it("exige un titre", () => {
		expect(minigameEventProblem({ type: "CLIP", title: "  " })).not.toBeNull();
	});
});

describe("renderMinigameEndAnnouncement", () => {
	it("annonce la reponse et le nombre de gagnants", () => {
		const texte = renderMinigameEndAnnouncement({
			type: "GUESS_SKIN",
			answer: "Rat de cale - Chacal",
			solved: 12,
			heroOnly: 3,
			participants: 20,
		});
		expect(texte).toContain("Rat de cale - Chacal");
		expect(texte).toContain("12 membres ont trouvé");
		expect(texte).toContain("3 autres");
	});

	it("dit quand personne n'a trouve le skin mais le heros", () => {
		const texte = renderMinigameEndAnnouncement({ type: "GUESS_SKIN", answer: "X", solved: 0, heroOnly: 2, participants: 5 });
		expect(texte).toContain("Personne n'a trouvé le skin");
	});

	it("n'annonce rien pour le duel ni pour le clip", () => {
		expect(renderMinigameEndAnnouncement({ type: "DUEL", answer: null, solved: 0, heroOnly: 0, participants: 0 })).toBeNull();
		expect(renderMinigameEndAnnouncement({ type: "CLIP", answer: null, solved: 0, heroOnly: 0, participants: 0 })).toBeNull();
	});

	it("annonce la reponse du vrai ou faux", () => {
		const texte = renderMinigameEndAnnouncement({ type: "TRUE_FALSE", answer: "Faux", solved: 34, heroOnly: 0, participants: 50 });
		expect(texte).toContain("**Faux**");
		expect(texte).toContain("34 bonnes réponses");
	});
});
