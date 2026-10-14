import { isFollowed, readPandascoreMatch, type PandascoreRawMatch } from "./pandascore.client";

/** Extrait d'une vraie reponse de `/ow/matches` (OWCS Japon, octobre 2026). */
function brut(overrides: Partial<PandascoreRawMatch> = {}): PandascoreRawMatch {
	return {
		id: 1713048,
		league_id: 5223,
		scheduled_at: "2026-10-14T12:00:00Z",
		rescheduled: false,
		status: "not_started",
		match_type: "first_to",
		number_of_games: 3,
		forfeit: false,
		league: { id: 5223, name: "OCS" },
		serie: { name: "Japan Stage 3", full_name: "Japan Stage 3 2026" },
		tournament: { name: "Group Stage" },
		opponents: [
			{
				type: "Team",
				opponent: {
					id: 135364,
					name: "99DIVINE",
					acronym: "99D",
					image_url: "https://cdn-api.pandascore.co/images/team/image/135364/99_divine_lightmode.png",
					dark_mode_image_url:
						"https://cdn-api.pandascore.co/dark_images/team/dark_image/135364/285px_99_divine_darkmode.png",
				},
			},
			{
				type: "Team",
				opponent: {
					id: 138285,
					name: "ENTER FORCE.36",
					acronym: "EF.36",
					image_url: "https://cdn-api.pandascore.co/images/team/image/138285/enter_force_36_2021_allmode.png",
					dark_mode_image_url: null,
				},
			},
		],
		// PandaScore ecrit 0 - 0 avant le match.
		results: [
			{ team_id: 135364, score: 0 },
			{ team_id: 138285, score: 0 },
		],
		streams_list: [
			{ main: false, official: false, raw_url: "https://www.youtube.com/watch?v=JkknMJHCHes" },
			{ main: true, official: true, raw_url: "https://www.twitch.tv/ow_esports_jp" },
		],
		...overrides,
	};
}

describe("readPandascoreMatch", () => {
	it("lit un FT3, pas un BO3", () => {
		const match = readPandascoreMatch(brut())!;

		expect(match.format).toBe("FIRST_TO");
		expect(match.games).toBe(3);
	});

	it("nomme la competition OWCS plutot que l'acronyme de PandaScore", () => {
		expect(readPandascoreMatch(brut())!.competition).toBe("OWCS Japan Stage 3");
	});

	it("prefere le logo pour fond sombre, et retombe sur le clair", () => {
		const match = readPandascoreMatch(brut())!;

		expect(match.teamA!.logoUrl).toContain("darkmode");
		expect(match.teamB!.logoUrl).toContain("allmode");
	});

	it("choisit le stream officiel principal", () => {
		expect(readPandascoreMatch(brut())!.streamUrl).toBe("https://www.twitch.tv/ow_esports_jp");
	});

	// Le 0 - 0 d'avant match ne doit jamais passer pour un score.
	it("ignore les scores tant que le match n'est pas termine", () => {
		expect(readPandascoreMatch(brut())!.scores.size).toBe(0);

		const fini = readPandascoreMatch(
			brut({
				status: "finished",
				results: [
					{ team_id: 135364, score: 3 },
					{ team_id: 138285, score: 1 },
				],
			}),
		)!;
		expect(fini.scores.get(135364)).toBe(3);
		expect(fini.scores.get(138285)).toBe(1);
	});

	it("garde un adversaire a determiner", () => {
		const match = readPandascoreMatch(brut({ opponents: [brut().opponents![0]!] }))!;

		expect(match.teamA!.name).toBe("99DIVINE");
		expect(match.teamB).toBeNull();
	});

	it("ecarte un match sans horaire prevu", () => {
		expect(readPandascoreMatch(brut({ scheduled_at: null }))).toBeNull();
	});
});

describe("isFollowed", () => {
	const match = readPandascoreMatch(brut())!;

	it("suit tout sans mot-cle", () => {
		expect(isFollowed(match, [])).toBe(true);
	});

	it("compare les mots-cles a la serie, sans tenir compte de la casse", () => {
		expect(isFollowed(match, ["japan"])).toBe(true);
		expect(isFollowed(match, ["EMEA", "North America"])).toBe(false);
	});
});
