import { QuarantineStage, quarantineStage } from "./quarantine";

const jamais = { acceptedAt: null, battlenetVerifiedAt: null };
const accepte = { acceptedAt: new Date(), battlenetVerifiedAt: null };
const verifie = { acceptedAt: null, battlenetVerifiedAt: new Date() };
const lesDeux = { acceptedAt: new Date(), battlenetVerifiedAt: new Date() };

describe("quarantineStage", () => {
	describe("sans verification Battle.net exigee", () => {
		it("libere des l'acceptation du reglement", () => {
			expect(quarantineStage(accepte, false)).toBe(QuarantineStage.CLEARED);
		});

		// Couper le reglage doit rendre exactement le comportement d'avant : une
		// verification faite quand elle etait encore exigee ne libere personne
		// toute seule, sinon des membres passeraient au travers du reglement.
		it("ne libere pas sur la seule verification", () => {
			expect(quarantineStage(verifie, false)).toBe(QuarantineStage.PENDING);
		});
	});

	describe("avec verification Battle.net exigee", () => {
		it("exige les deux etapes", () => {
			expect(quarantineStage(accepte, true)).toBe(QuarantineStage.ACCEPTED_ONLY);
			expect(quarantineStage(verifie, true)).toBe(QuarantineStage.VERIFIED_ONLY);
			expect(quarantineStage(lesDeux, true)).toBe(QuarantineStage.CLEARED);
		});

		it("laisse en attente tant que rien n'est fait", () => {
			expect(quarantineStage(jamais, true)).toBe(QuarantineStage.PENDING);
		});
	});

	// Le bouton du dashboard existe justement pour les cas ou la verification ne
	// peut pas aboutir (compte Blizzard inaccessible, membre de confiance) : le
	// laisser bloque sur une etape que le staff a explicitement contournee
	// viderait le bouton de son sens.
	it("libere sur une levee manuelle, quelles que soient les etapes", () => {
		expect(
			quarantineStage({ ...jamais, releasedById: "uuid" }, true),
		).toBe(QuarantineStage.CLEARED);
	});
});
