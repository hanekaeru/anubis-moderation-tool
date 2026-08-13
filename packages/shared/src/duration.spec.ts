import {
	DurationUnit,
	durationToSeconds,
	formatDurationSeconds,
} from "./duration";

describe("durationToSeconds", () => {
	it("convertit chaque unite en secondes", () => {
		expect(durationToSeconds(2, DurationUnit.SECONDS)).toBe(2);
		expect(durationToSeconds(2, DurationUnit.MINUTES)).toBe(120);
		expect(durationToSeconds(2, DurationUnit.HOURS)).toBe(7200);
		expect(durationToSeconds(2, DurationUnit.DAYS)).toBe(172800);
		expect(durationToSeconds(2, DurationUnit.WEEKS)).toBe(1209600);
		expect(durationToSeconds(2, DurationUnit.MONTHS)).toBe(5184000);
		expect(durationToSeconds(2, DurationUnit.YEARS)).toBe(63072000);
	});

	it("renvoie null pour une sanction permanente", () => {
		expect(durationToSeconds(1, DurationUnit.PERMANENT)).toBeNull();
	});
});

describe("formatDurationSeconds", () => {
	it("utilise le fallback quand la duree est absente", () => {
		expect(formatDurationSeconds(null)).toBe("Permanent");
		expect(formatDurationSeconds(undefined)).toBe("Permanent");
		expect(formatDurationSeconds(null, "Indefini")).toBe("Indefini");
	});

	it("formate les secondes en dessous d'une minute", () => {
		expect(formatDurationSeconds(0)).toBe("0 s");
		expect(formatDurationSeconds(59)).toBe("59 s");
	});

	it("formate les minutes en dessous d'une heure", () => {
		expect(formatDurationSeconds(60)).toBe("1 min");
		expect(formatDurationSeconds(59 * 60)).toBe("59 min");
	});

	it("formate les heures en dessous d'un jour, avec et sans reste", () => {
		expect(formatDurationSeconds(60 * 60)).toBe("1 h");
		expect(formatDurationSeconds(60 * 60 + 5 * 60)).toBe("1 h 5 min");
		expect(formatDurationSeconds(23 * 60 * 60)).toBe("23 h");
	});

	it("formate les jours et plus, avec et sans reste", () => {
		expect(formatDurationSeconds(24 * 60 * 60)).toBe("1 j");
		expect(formatDurationSeconds(24 * 60 * 60 + 3 * 60 * 60)).toBe("1 j 3 h");
		expect(formatDurationSeconds(10 * 24 * 60 * 60)).toBe("10 j");
	});
});
