import {
	dayKey,
	fillDailySeries,
	sortRoles,
	toActorRef,
	toMemberRef,
} from "./mappers";

describe("toMemberRef", () => {
	it("construit une reference de membre avec l'URL d'avatar", () => {
		const ref = toMemberRef({
			id: "250902879667879937",
			username: "hanekaeru",
			globalName: "Haneka",
			avatarUrl: "https://cdn.discordapp.com/avatars/250902879667879937/abcdef.png",
		});

		expect(ref).toEqual({
			userId: "250902879667879937",
			username: "hanekaeru",
			globalName: "Haneka",
			avatarUrl: "https://cdn.discordapp.com/avatars/250902879667879937/abcdef.png",
		});
	});
});

describe("toActorRef", () => {
	it("priorise le compte dashboard sur le compte Discord", () => {
		const ref = toActorRef(
			{ id: "1", username: "bot-user", globalName: null, avatarUrl: null },
			{ id: "app-1", username: "admin", displayName: "Admin" },
		);
		expect(ref).toEqual({ kind: "app", id: "app-1", label: "Admin" });
	});

	it("retombe sur le compte Discord quand aucun compte dashboard n'est fourni", () => {
		const ref = toActorRef(
			{ id: "1", username: "hanekaeru", globalName: "Haneka", avatarUrl: null },
			null,
		);
		expect(ref).toEqual({ kind: "discord", id: "1", label: "Haneka" });
	});

	it("retombe sur le nom d'utilisateur Discord si le nom global est absent", () => {
		const ref = toActorRef(
			{ id: "1", username: "hanekaeru", globalName: null, avatarUrl: null },
			null,
		);
		expect(ref).toEqual({ kind: "discord", id: "1", label: "hanekaeru" });
	});

	it("retombe sur le systeme quand aucun auteur n'est connu", () => {
		expect(toActorRef(null, null)).toEqual({
			kind: "system",
			id: null,
			label: "Systeme",
		});
	});
});

describe("sortRoles", () => {
	it("trie du plus haut au plus bas, comme Discord", () => {
		const roles = [
			{ id: "1", name: "Low", color: 0, position: 1, managed: false, trackHistory: true, separator: false },
			{ id: "2", name: "High", color: 0, position: 10, managed: false, trackHistory: true, separator: false },
			{ id: "3", name: "Mid", color: 0, position: 5, managed: false, trackHistory: true, separator: false },
		];

		expect(sortRoles(roles).map((r) => r.id)).toEqual(["2", "3", "1"]);
	});

	it("ne modifie pas le tableau d'origine", () => {
		const roles = [
			{ id: "1", name: "Low", color: 0, position: 1, managed: false, trackHistory: true, separator: false },
			{ id: "2", name: "High", color: 0, position: 10, managed: false, trackHistory: true, separator: false },
		];
		const original = [...roles];

		sortRoles(roles);
		expect(roles).toEqual(original);
	});
});

describe("fillDailySeries", () => {
	it("complete les jours manquants avec zero, bornes incluses", () => {
		const from = new Date("2026-01-01T00:00:00.000Z");
		const to = new Date("2026-01-03T00:00:00.000Z");
		const counts = new Map([["2026-01-02", 5]]);

		expect(fillDailySeries(counts, from, to)).toEqual([
			{ date: "2026-01-01", value: 0 },
			{ date: "2026-01-02", value: 5 },
			{ date: "2026-01-03", value: 0 },
		]);
	});

	it("renvoie un seul point quand from et to sont le meme jour", () => {
		const day = new Date("2026-01-01T12:00:00.000Z");
		expect(fillDailySeries(new Map(), day, day)).toEqual([
			{ date: "2026-01-01", value: 0 },
		]);
	});
});

describe("dayKey", () => {
	it("formate une date en YYYY-MM-DD, en UTC", () => {
		expect(dayKey(new Date("2026-03-05T23:59:59.000Z"))).toBe("2026-03-05");
	});
});
