import {
	isDateKey,
	zonedDateKey,
	zonedTimeOfDay,
	zonedWallTimeToUtc,
	zonedWeekStart,
} from "./timezone";

const PARIS = "Europe/Paris";

describe("zonedWallTimeToUtc", () => {
	it("convertit une heure d'ete (UTC+2)", () => {
		expect(zonedWallTimeToUtc("2026-10-13", "20:00", PARIS).toISOString()).toBe(
			"2026-10-13T18:00:00.000Z",
		);
	});

	it("convertit une heure d'hiver (UTC+1)", () => {
		expect(zonedWallTimeToUtc("2026-12-01", "20:00", PARIS).toISOString()).toBe(
			"2026-12-01T19:00:00.000Z",
		);
	});

	// Le lendemain du passage a l'heure d'hiver : l'estimation tombe du mauvais
	// cote du changement, c'est la seconde passe qui corrige.
	it("tombe juste le jour du changement d'heure", () => {
		expect(zonedWallTimeToUtc("2026-10-25", "20:00", PARIS).toISOString()).toBe(
			"2026-10-25T19:00:00.000Z",
		);
		expect(zonedWallTimeToUtc("2026-03-29", "20:00", PARIS).toISOString()).toBe(
			"2026-03-29T18:00:00.000Z",
		);
	});

	it("fait l'aller-retour avec zonedDateKey et zonedTimeOfDay", () => {
		const instant = zonedWallTimeToUtc("2026-07-14", "21:30", PARIS);
		expect(zonedDateKey(instant, PARIS)).toBe("2026-07-14");
		expect(zonedTimeOfDay(instant, PARIS)).toBe("21:30");
	});
});

describe("zonedWeekStart", () => {
	// Dimanche 22 h 30 UTC, c'est deja lundi 0 h 30 a Paris : le match appartient
	// a la semaine suivante.
	it("raisonne a l'heure de Paris, pas en UTC", () => {
		expect(zonedWeekStart(new Date("2026-10-18T22:30:00Z"), PARIS)).toBe("2026-10-19");
		expect(zonedWeekStart(new Date("2026-10-18T20:30:00Z"), PARIS)).toBe("2026-10-12");
	});
});

describe("isDateKey", () => {
	it("refuse une date qui n'existe pas", () => {
		expect(isDateKey("2026-02-30")).toBe(false);
		expect(isDateKey("2026-02-28")).toBe(true);
	});
});
