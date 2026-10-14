import {
	buildEsportResultEmbed,
	buildEsportWeekEmbeds,
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

describe("buildEsportWeekEmbeds", () => {
	const embeds = (matches: EsportEmbedMatch[], description: string | null = null) =>
		buildEsportWeekEmbeds({ weekStart: "2026-10-12", title: null, description, matches }, SETTINGS);
	/** Semaine sans region : un seul embed. */
	const semaine = (matches: EsportEmbedMatch[]) => embeds(matches)[0]!;

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

	it("fait un embed par region, dans l'ordre des regions, « Autres » en dernier", () => {
		const resultat = embeds([
			match({ region: "NA", scheduledAt: "2026-10-17T23:00:00.000Z" }),
			match({ region: null }),
			match({ region: "KR", scheduledAt: "2026-10-17T06:00:00.000Z" }),
			match({ region: "EMEA", scheduledAt: "2026-10-17T17:00:00.000Z" }),
		]);

		expect(resultat.map((embed) => embed.title)).toEqual([
			"🇪🇺 EMEA",
			"🇺🇸 Amérique du Nord",
			"🇰🇷 Corée",
			"🎮 Autres",
		]);
	});

	// Chaque embed porte son en-tete : titre de la semaine, region, dates.
	it("met un en-tete sur chaque embed, l'introduction sur le premier seulement", () => {
		const [emea, na] = embeds(
			[match({ region: "EMEA" }), match({ region: "NA" })],
			"Bonne semaine !",
		);

		for (const embed of [emea!, na!]) {
			expect(embed.author).toEqual({ name: "Matchs" });
			expect(embed.description).toContain("📅 Du lundi 12 octobre au dimanche 18 octobre");
		}
		expect(emea!.description).toContain("Bonne semaine !");
		expect(na!.description).not.toContain("Bonne semaine !");
	});

	it("donne a chaque region sa couleur, celle du serveur l'emportant", () => {
		const matches = [match({ region: "EMEA" }), match({ region: "NA" }), match()];
		const [emea, na, autres] = buildEsportWeekEmbeds(
			{ weekStart: "2026-10-12", title: null, description: null, matches },
			{ ...SETTINGS, regionColors: { NA: 0x123456 } },
		);

		expect(emea!.color).toBe(0x3b82f6);
		expect(na!.color).toBe(0x123456);
		expect(autres!.color).toBe(SETTINGS.color);
	});

	it("ne met le pied que sur le dernier embed", () => {
		const resultat = embeds([match({ region: "EMEA" }), match({ region: "NA", pandascoreId: 1 })]);

		expect(resultat[0]!.footer).toBeUndefined();
		expect(resultat[1]!.footer!.text).toContain("Source : PandaScore");
	});

	// Ce que toute la region partage n'est ecrit qu'une fois.
	it("ecrit dans la description la competition, le format et le stream communs", () => {
		const commun = { region: "EMEA", competition: "OWCS EMEA Stage 3", streamUrl: "https://twitch.tv/ow" };
		const [embed] = embeds([match(commun), match({ ...commun, scheduledAt: "2026-10-14T18:00:00.000Z" })]);

		expect(embed!.description).toContain("🏆 OWCS Stage 3 · BO5 · 📺 [Stream](https://twitch.tv/ow)");
		expect(embed!.fields.map((field) => field.name)).toEqual(["Mardi 13 octobre", "Mercredi 14 octobre"]);
		for (const field of embed!.fields) {
			expect(field.value).not.toContain("Stage 3");
			expect(field.value).not.toContain("BO5");
			expect(field.value).not.toContain("Stream");
		}
	});

	it("garde sur sa ligne ce qu'un match ne partage pas", () => {
		const [embed] = embeds([
			match({ region: "EMEA", streamUrl: "https://twitch.tv/a" }),
			match({ region: "EMEA", streamUrl: "https://twitch.tv/b", format: "FIRST_TO", bestOf: 3 }),
		]);
		const [, ligneB] = embed!.fields[0]!.value.split("\n");

		expect(embed!.description).toContain("🏆 OWCS");
		expect(embed!.description).not.toContain("Stream");
		expect(ligneB).toContain("FT3");
		expect(ligneB).toContain("[Stream](https://twitch.tv/b)");
	});

	it("ne retire rien du nom d'un evenement international", () => {
		const [embed] = embeds([match({ region: "INTL", competition: "OWCS World Finals" })]);

		expect(embed!.description).toContain("OWCS World Finals");
	});

	it("garde un seul embed, sans en-tete de region, sans region dans la semaine", () => {
		const resultat = embeds([match(), match()]);

		expect(resultat.length).toBe(1);
		expect(resultat[0]!.title).toBe("Matchs");
		expect(resultat[0]!.author).toBeUndefined();
	});

	it("poursuit une journee trop chargee dans un champ « (suite) »", () => {
		// Un stream different par match : rien a mettre en commun, les lignes restent longues.
		const longs = Array.from({ length: 12 }, (_, index) =>
			match({ region: "EMEA", streamUrl: `https://twitch.tv/${index}${"x".repeat(60)}` }),
		);
		const [embed] = embeds(longs);

		expect(embed!.fields[1]!.name).toBe("Mardi 13 octobre (suite)");
		expect(embed!.fields.every((field) => field.value.length <= 1024)).toBe(true);
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
