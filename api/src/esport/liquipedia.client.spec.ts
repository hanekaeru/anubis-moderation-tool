import { isFollowed, readLiquipediaMatch, trimLiquipediaMatch, type LiquipediaRawMatch } from "./liquipedia.client";

/**
 * Forme d'un match de `/match` sur le wiki Overwatch (OWCS EMEA Stage 3,
 * octobre 2026) : le match vit sur la sous-page « Regular Season », son
 * `parent` est la page du Stage.
 */
function brut(overrides: Partial<LiquipediaRawMatch> = {}): LiquipediaRawMatch {
	return {
		match2id: "fBwJS4HlCs_0001",
		date: "2026-10-10 17:20:00",
		dateexact: 1,
		finished: 0,
		bestof: 5,
		winner: "",
		status: "",
		stream: { twitch: "ow_esports", youtube_en_1: "Overwatch Esports" },
		parent: "Overwatch_Champions_Series/2026/EMEA/Stage_3",
		pagename: "Overwatch_Champions_Series/2026/EMEA/Stage_3/Regular_Season",
		tournament: "Overwatch Champions Series 2026 - EMEA Stage 3 - Regular Season",
		tickername: "OWCS EMEA Stage 3 - Regular Season",
		series: "Overwatch Champions Series",
		match2opponents: [
			{ type: "team", name: "Twisted Minds", template: "twisted minds", icondark: "Twisted Minds 2023 darkmode.png", score: -1, status: "" },
			{ type: "team", name: "Team Peps", template: "team peps", icon: "Team Peps allmode.png", score: -1, status: "" },
		],
		...overrides,
	};
}

const FT = { firstTo: true, now: new Date("2026-10-01T00:00:00Z") };

describe("readLiquipediaMatch", () => {
	it("lit la date en UTC", () => {
		expect(readLiquipediaMatch(brut(), FT)!.scheduledAt.toISOString()).toBe("2026-10-10T17:20:00.000Z");
	});

	it("lit un BO5 en FT3 quand le reglage le demande, en BO5 sinon", () => {
		expect(readLiquipediaMatch(brut(), FT)).toMatchObject({ format: "FIRST_TO", games: 3 });
		expect(readLiquipediaMatch(brut(), { ...FT, firstTo: false })).toMatchObject({ format: "BEST_OF", games: 5 });
	});

	it("cite la page du Stage, pas celle de la phase", () => {
		expect(readLiquipediaMatch(brut(), FT)!.page).toBe("Overwatch_Champions_Series/2026/EMEA/Stage_3");
	});

	it("reconnait la region, y compris l'Amerique du Nord ecrite NA", () => {
		expect(readLiquipediaMatch(brut(), FT)!.region).toBe("EMEA");
		const na = brut({
			tickername: "OWCS NA Stage 3 - Regular Season",
			tournament: "Overwatch Champions Series 2026 - NA Stage 3",
			parent: "Overwatch_Champions_Series/2026/NA/Stage_3",
		});
		expect(readLiquipediaMatch(na, FT)!.region).toBe("NA");
	});

	it("n'a aucun score avant la fin, meme avec des manches deja jouees", () => {
		const enCours = brut({
			match2opponents: [
				{ name: "Twisted Minds", score: 2, status: "S" },
				{ name: "Team Peps", score: 1, status: "S" },
			],
		});
		const pendant = { ...FT, now: new Date("2026-10-10T18:00:00Z") };
		expect(readLiquipediaMatch(enCours, pendant)).toMatchObject({ status: "live", score: null });
	});

	it("lit le score d'un match termine", () => {
		const fini = brut({
			finished: 1,
			winner: "1",
			match2opponents: [
				{ name: "Twisted Minds", score: 3, status: "S" },
				{ name: "Team Peps", score: 1, status: "S" },
			],
		});
		expect(readLiquipediaMatch(fini, FT)).toMatchObject({ status: "finished", score: { a: 3, b: 1 }, forfeit: false });
	});

	it("propose le score minimal d'une victoire par forfait", () => {
		const forfait = brut({
			finished: 1,
			match2opponents: [
				{ name: "Twisted Minds", score: -1, status: "FF" },
				{ name: "Team Peps", score: -1, status: "W" },
			],
		});
		expect(readLiquipediaMatch(forfait, FT)).toMatchObject({ score: { a: 0, b: 3 }, forfeit: true });
	});

	it("ignore un adversaire encore a determiner", () => {
		const tbd = brut({ match2opponents: [{ name: "TBD", template: "tbd" }, { name: "Team Peps" }] });
		expect(readLiquipediaMatch(tbd, FT)!.teamA).toBeNull();
	});

	// Liquipedia refuse ses images aux autres sites (403) : aucun logo repris.
	it("ne reprend aucun logo", () => {
		expect(readLiquipediaMatch(brut(), FT)!.teamA).toEqual({ key: "Twisted Minds", name: "Twisted Minds" });
	});

	it("reconstruit le lien Twitch depuis le nom de chaine", () => {
		expect(readLiquipediaMatch(brut(), FT)!.streamUrl).toBe("https://www.twitch.tv/ow_esports");
	});

	it("ecarte un match sans horaire", () => {
		expect(readLiquipediaMatch(brut({ date: "1970-01-01 00:00:00" }), FT)).toBeNull();
	});
});

describe("trimLiquipediaMatch", () => {
	it("retire les manches et les joueurs du cache", () => {
		const allege = trimLiquipediaMatch({
			...brut(),
			match2games: [{ map: "Ilios" }],
			match2opponents: [{ name: "Twisted Minds", match2players: [{ name: "Joueur" }] } as never],
		});
		expect(allege).not.toHaveProperty("match2games");
		expect(allege.match2opponents![0]).not.toHaveProperty("match2players");
	});
});

describe("isFollowed", () => {
	it("cherche les mots-cles dans le tournoi et sa page", () => {
		const match = readLiquipediaMatch(brut(), FT)!;
		expect(isFollowed(match, [])).toBe(true);
		expect(isFollowed(match, ["emea"])).toBe(true);
		expect(isFollowed(match, ["Korea"])).toBe(false);
	});
});
