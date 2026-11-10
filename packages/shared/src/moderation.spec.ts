import { DEFAULT_MODERATION_POINTS } from "./dto/moderation";
import { moderationPointsFromRow, sanctionSchedule } from "./moderation";

describe("sanctionSchedule", () => {
	const debut = new Date("2026-11-10T12:00:00Z");

	it("fait finir une sanction a duree a l'heure prevue", () => {
		expect(sanctionSchedule("TIMEOUT", 600, debut)).toEqual({
			durationSeconds: 600,
			startsAt: debut,
			expiresAt: new Date("2026-11-10T12:10:00Z"),
			status: "ACTIVE",
		});
	});

	it("laisse une sanction sans duree active indefiniment", () => {
		const { durationSeconds, expiresAt, status } = sanctionSchedule("BAN", null, debut);
		expect({ durationSeconds, expiresAt, status }).toEqual({
			durationSeconds: null,
			expiresAt: null,
			status: "ACTIVE",
		});
	});

	// Une expulsion se termine dans la foulee : ACTIVE, elle resterait affichee
	// comme sanction en cours pour toujours. Une duree saisie par erreur ne
	// change rien.
	it("termine immediatement une sanction instantanee", () => {
		const { durationSeconds, expiresAt, status } = sanctionSchedule("KICK", 600, debut);
		expect({ durationSeconds, expiresAt, status }).toEqual({
			durationSeconds: null,
			expiresAt: null,
			status: "EXPIRED",
		});
	});
});

describe("moderationPointsFromRow", () => {
	it("rend le bareme par defaut sans ligne, sans partager ses objets", () => {
		const bareme = moderationPointsFromRow(null);
		expect(bareme).toEqual(DEFAULT_MODERATION_POINTS);

		bareme.sanctionPoints.BAN = 99;
		expect(DEFAULT_MODERATION_POINTS.sanctionPoints.BAN).not.toBe(99);
	});

	it("traduit chaque colonne vers sa cle", () => {
		expect(
			moderationPointsFromRow({
				warningLowPoints: 1,
				warningMediumPoints: 2,
				warningHighPoints: 3,
				timeoutPoints: 4,
				kickPoints: 5,
				banPoints: 6,
				shadowbanPoints: 7,
				warnThreshold: 8,
				criticalThreshold: 9,
			}),
		).toEqual({
			warningPoints: { LOW: 1, MEDIUM: 2, HIGH: 3 },
			sanctionPoints: { TIMEOUT: 4, KICK: 5, BAN: 6, SHADOWBAN: 7 },
			warnThreshold: 8,
			criticalThreshold: 9,
		});
	});
});
