import {
	buildEsportResultEmbed,
	buildEsportWeekEmbed,
	detectEsportRegion,
	esportCalendarDay,
	esportDayKey,
	esportDayLabel,
	esportWeekStart,
	type EsportEmbedMatch,
} from "./esport";

const SETTINGS = { title: "Matchs", color: 1, spoilerScores: true };

const FALCONS = { name: "Falcons", emoji: "🦅", logoUrl: "https://exemple.fr/falcons.png", highlighted: true };
const LIQUID = { name: "Team_Liquid", emoji: null, logoUrl: null, highlighted: false };

function match(overrides: Partial<EsportEmbedMatch> = {}): EsportEmbedMatch {
	return {
		teamA: FALCONS,
		teamB: LIQUID,
		competition: "OWCS EMEA",
		region: null,
		// Mardi 13 octobre 2026, 20 h a Paris.
		scheduledAt: "2026-10-13T18:00:00.000Z",
		format: "BEST_OF",
		bestOf: 5,
		streamUrl: null,
		pandascoreId: null,
		finished: false,
		scoreA: null,
		scoreB: null,
		spoiler: null,
		...overrides,
	};
}

describe("buildEsportWeekEmbed", () => {
	const semaine = (matches: EsportEmbedMatch[]) =>
		buildEsportWeekEmbed({ weekStart: "2026-10-12", title: null, description: null, matches }, SETTINGS);

	it("regroupe les matchs par jour, a l'heure de Paris", () => {
		const embed = semaine([
			match(),
			// Dimanche 23 h 30 a Paris (21 h 30 UTC) : reste dans la semaine.
			match({ scheduledAt: "2026-10-18T21:30:00.000Z" }),
		]);

		expect(embed.fields.map((field) => field.name)).toEqual([
			"Mardi 13 octobre",
			"Dimanche 18 octobre",
		]);
	});

	it("ecrit l'heure en horodatage Discord et echappe les noms", () => {
		const [field] = semaine([match()]).fields;

		expect(field!.value).toContain("<t:1791914400:t>");
		expect(field!.value).toContain("Team\\_Liquid");
		expect(field!.value).toContain("**Falcons**");
	});

	// Le reglage du serveur vaut par defaut, le match peut faire exception.
	it("met le score en spoiler selon le match, puis selon le serveur", () => {
		const fini = { finished: true, scoreA: 3, scoreB: 1 };

		expect(semaine([match(fini)]).fields[0]!.value).toContain("||**3 - 1**||");
		expect(semaine([match({ ...fini, spoiler: false })]).fields[0]!.value).toContain(
			" **3 - 1** ",
		);
	});

	it("poursuit un jour trop charge dans un champ « (suite) »", () => {
		const longs = Array.from({ length: 12 }, () =>
			match({ streamUrl: `https://twitch.tv/${"x".repeat(60)}` }),
		);
		const embed = semaine(longs);

		expect(embed.fields.length).toBeGreaterThan(1);
		expect(embed.fields[1]!.name).toBe("Mardi 13 octobre (suite)");
		expect(embed.fields.every((field) => field.value.length <= 1024)).toBe(true);
	});

	it("annonce une semaine vide", () => {
		expect(semaine([]).description).toContain("Aucun match prévu");
	});

	// Les matchs nord-americains du dimanche se jouent apres minuit a Paris.
	it("range un match d'avant 06:00 sous la journee de la veille, avec une lune", () => {
		const embed = semaine([
			match({ scheduledAt: "2026-10-18T17:00:00.000Z" }),
			// Lundi 19 octobre, 1 h a Paris.
			match({ scheduledAt: "2026-10-18T23:00:00.000Z" }),
		]);

		expect(embed.fields.map((field) => field.name)).toEqual(["Dimanche 18 octobre"]);
		expect(embed.fields[0]!.value).toContain("🌙 <t:");
		expect(embed.fields[0]!.value.split("\n")[0]).not.toContain("🌙");
	});

	it("groupe une journee par region, dans l'ordre du premier match", () => {
		const embed = semaine([
			match({ region: "EMEA", scheduledAt: "2026-10-17T17:00:00.000Z" }),
			match({ region: "KR", scheduledAt: "2026-10-17T06:00:00.000Z" }),
			match({ region: "NA", scheduledAt: "2026-10-17T23:00:00.000Z" }),
			match({ region: "EMEA", scheduledAt: "2026-10-17T18:30:00.000Z" }),
		]);
		const lignes = embed.fields[0]!.value.split("\n");

		expect(lignes.filter((ligne) => ligne.startsWith("**"))).toEqual([
			"**🇰🇷 Corée**",
			"**🇪🇺 EMEA**",
			"**🇺🇸 Amérique du Nord**",
		]);
		expect(lignes[3]).toContain("<t:");
		expect(lignes[4]).toContain("<t:");
	});

	it("n'ajoute aucun intertitre sans region dans la semaine", () => {
		expect(semaine([match(), match()]).fields[0]!.value).not.toContain("**🎮");
	});

	it("range sous « Autres » un match sans region quand d'autres en ont", () => {
		expect(semaine([match({ region: "EMEA" }), match()]).fields[0]!.value).toContain("**🎮 Autres**");
	});

	it("repete l'intertitre de la region dans un champ « (suite) »", () => {
		const longs = Array.from({ length: 12 }, () =>
			match({ region: "EMEA", streamUrl: `https://twitch.tv/${"x".repeat(60)}` }),
		);
		const embed = semaine(longs);

		expect(embed.fields[1]!.name).toBe("Mardi 13 octobre (suite)");
		expect(embed.fields[1]!.value.startsWith("**🇪🇺 EMEA**\n")).toBe(true);
	});

	it("distingue un FT3 d'un BO3", () => {
		const [field] = semaine([match({ format: "FIRST_TO", bestOf: 3 })]).fields;

		expect(field!.value).toContain("FT3");
		expect(field!.value).not.toContain("BO3");
	});

	// Condition de reutilisation des donnees PandaScore.
	it("cite PandaScore des qu'un match en vient, et seulement alors", () => {
		expect(semaine([match()]).footer!.text).not.toContain("PandaScore");
		expect(semaine([match(), match({ pandascoreId: 1713048 })]).footer!.text).toContain(
			"Source : PandaScore",
		);
	});
});

describe("buildEsportResultEmbed", () => {
	const fini = match({ finished: true, scoreA: 3, scoreB: 1 });

	// Sous spoiler, le logo du gagnant trahirait le resultat avant le clic.
	it("cache le vainqueur et son logo sous spoiler", () => {
		const embed = buildEsportResultEmbed(fini, SETTINGS);

		expect(embed.description).toContain("||**Falcons**||");
		expect(embed.thumbnail).toBeUndefined();
	});

	it("nomme le vainqueur et montre son logo sans spoiler", () => {
		const embed = buildEsportResultEmbed({ ...fini, spoiler: false }, SETTINGS);

		expect(embed.description).toContain("Victoire de **Falcons**");
		expect(embed.thumbnail).toEqual({ url: "https://exemple.fr/falcons.png" });
	});

	it("cite PandaScore pour un match importe", () => {
		const embed = buildEsportResultEmbed({ ...fini, pandascoreId: 1713048 }, SETTINGS);

		expect(embed.footer!.text).toContain("Source : PandaScore");
	});
});

describe("journee esport", () => {
	it("rattache la nuit du dimanche au lundi a la semaine du dimanche", () => {
		// Lundi 19 octobre, 5 h 59 puis 6 h a Paris.
		expect(esportWeekStart(new Date("2026-10-19T03:59:00.000Z"))).toBe("2026-10-12");
		expect(esportWeekStart(new Date("2026-10-19T04:00:00.000Z"))).toBe("2026-10-19");
	});

	// Nuit du changement d'heure (25 octobre 2026) : on raisonne en heure locale.
	it("tient compte du changement d'heure", () => {
		// Dimanche 25 octobre, 5 h 30 a Paris (heure d'hiver) : journee du samedi.
		expect(esportDayKey(new Date("2026-10-25T04:30:00.000Z"))).toBe("2026-10-24");
	});

	it("convertit une saisie de nuit vers le lendemain calendaire", () => {
		expect(esportCalendarDay("2026-10-18", "01:00")).toBe("2026-10-19");
		expect(esportCalendarDay("2026-10-18", "19:00")).toBe("2026-10-18");
	});

	it("reconnait la region dans un intitule PandaScore", () => {
		expect(detectEsportRegion("OWCS North America Stage 3")).toBe("NA");
		expect(detectEsportRegion("OWCS EMEA Stage 3")).toBe("EMEA");
		expect(detectEsportRegion("OWCS World Finals")).toBe("INTL");
		expect(detectEsportRegion("Coupe locale")).toBeNull();
	});
});

describe("esportDayLabel", () => {
	it("ecrit le jour en francais avec une majuscule", () => {
		expect(esportDayLabel("2026-10-12")).toBe("Lundi 12 octobre");
	});
});
