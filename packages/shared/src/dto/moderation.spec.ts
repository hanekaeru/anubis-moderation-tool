import { DEFAULT_MODERATION_POINTS, ModerationRisk, moderationRisk } from "./moderation";

const seuils = { warnThreshold: 6, criticalThreshold: 12 };

describe("moderationRisk", () => {
	it("ne signale rien sous le seuil d'alerte", () => {
		expect(moderationRisk(0, seuils)).toBe(ModerationRisk.CLEAN);
		expect(moderationRisk(5, seuils)).toBe(ModerationRisk.CLEAN);
	});

	it("bascule pile au seuil : un seuil qui ne declenche jamais serait un mensonge", () => {
		expect(moderationRisk(6, seuils)).toBe(ModerationRisk.WATCH);
		expect(moderationRisk(12, seuils)).toBe(ModerationRisk.CRITICAL);
	});

	it("reste en alerte entre les deux seuils", () => {
		expect(moderationRisk(11, seuils)).toBe(ModerationRisk.WATCH);
	});

	it("retient la lecture la plus severe quand les seuils sont inverses", () => {
		// Un critique place sous l'alerte est une erreur de saisie ; la fiche doit
		// alerter davantage, pas moins.
		const inverses = { warnThreshold: 20, criticalThreshold: 5 };
		expect(moderationRisk(6, inverses)).toBe(ModerationRisk.CRITICAL);
	});

	it("place les seuils par defaut au-dessus d'un avertissement isole", () => {
		const { warningPoints, warnThreshold } = DEFAULT_MODERATION_POINTS;
		// Un premier avertissement, meme grave, ne doit pas suffire a marquer un
		// membre : le score sert a reperer une accumulation.
		expect(warningPoints.HIGH).toBeLessThan(warnThreshold);
	});

	it("fait basculer un bannissement seul en problematique", () => {
		const { sanctionPoints, criticalThreshold } = DEFAULT_MODERATION_POINTS;
		expect(sanctionPoints.BAN).toBeGreaterThanOrEqual(criticalThreshold - 2);
	});
});
