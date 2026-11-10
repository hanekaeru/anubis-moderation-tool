import {
	BATTLENET_LINK_RETENTION_DAYS,
	battlenetLinkExpired,
	battlenetUnlinkResetsVerification,
	battletagExpired,
} from "./battlenet";
import { QuarantineStage } from "./dto/quarantine";

const maintenant = new Date("2027-06-01T12:00:00Z");
const ilYa = (jours: number) => new Date(maintenant.getTime() - jours * 86_400_000);

const faits = {
	unlinkedAt: null,
	leftAt: null,
	banActive: false,
	banEndedAt: null,
};

describe("battletagExpired", () => {
	it("garde le BattleTag 30 jours, pas un de plus", () => {
		expect(battletagExpired(ilYa(29), maintenant)).toBe(false);
		expect(battletagExpired(ilYa(30), maintenant)).toBe(true);
	});
});

describe("battlenetLinkExpired", () => {
	it("ne supprime jamais le lien actif d'un membre present", () => {
		expect(battlenetLinkExpired(faits, maintenant)).toBe(false);
		// Meme apres un bannissement leve : le membre est revenu, le lien sert.
		expect(battlenetLinkExpired({ ...faits, banEndedAt: ilYa(800) }, maintenant)).toBe(false);
	});

	it("supprime 12 mois apres le depart", () => {
		expect(battlenetLinkExpired({ ...faits, leftAt: ilYa(364) }, maintenant)).toBe(false);
		expect(
			battlenetLinkExpired({ ...faits, leftAt: ilYa(BATTLENET_LINK_RETENTION_DAYS) }, maintenant),
		).toBe(true);
	});

	it("supprime une trace 12 mois apres la deliaison", () => {
		expect(battlenetLinkExpired({ ...faits, unlinkedAt: ilYa(100) }, maintenant)).toBe(false);
		expect(battlenetLinkExpired({ ...faits, unlinkedAt: ilYa(400) }, maintenant)).toBe(true);
	});

	it("garde tout tant qu'un bannissement est en cours", () => {
		expect(
			battlenetLinkExpired({ ...faits, leftAt: ilYa(2000), banActive: true }, maintenant),
		).toBe(false);
	});

	it("compte les 12 mois depuis la fin du bannissement", () => {
		// Parti il y a trois ans, banni jusqu'il y a deux mois.
		expect(
			battlenetLinkExpired({ ...faits, leftAt: ilYa(1100), banEndedAt: ilYa(60) }, maintenant),
		).toBe(false);
		expect(
			battlenetLinkExpired({ ...faits, leftAt: ilYa(1100), banEndedAt: ilYa(370) }, maintenant),
		).toBe(true);
	});
});

describe("battlenetUnlinkResetsVerification", () => {
	it("laisse son acces a un membre libere, et l'etape a celui qui ne l'est pas", () => {
		expect(battlenetUnlinkResetsVerification(QuarantineStage.CLEARED)).toBe(false);
		expect(battlenetUnlinkResetsVerification(QuarantineStage.VERIFIED_ONLY)).toBe(true);
		expect(battlenetUnlinkResetsVerification(QuarantineStage.ACCEPTED_ONLY)).toBe(true);
	});
});
