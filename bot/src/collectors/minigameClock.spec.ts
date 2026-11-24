import * as horloge from "./minigameClock";
import { loadCommands } from "../loadCommands";

const CIBLE = new Date("2027-03-10T07:30:00Z");

describe("horloge des mini-jeux", () => {
	const avant = process.env.MINIGAME_TEST_MODE;

	afterEach(() => {
		horloge.revenirALHeureReelle();
		if (avant === undefined) delete process.env.MINIGAME_TEST_MODE;
		else process.env.MINIGAME_TEST_MODE = avant;
	});

	it("ignore tout decalage hors mode test", () => {
		process.env.MINIGAME_TEST_MODE = "true";
		horloge.regler(CIBLE);
		delete process.env.MINIGAME_TEST_MODE;

		// Une horloge oubliee ne doit rien changer une fois le mode coupe.
		expect(Math.abs(horloge.maintenant().getTime() - Date.now())).toBeLessThan(1000);
		expect(horloge.estDecalee()).toBe(false);
	});

	it("refuse d'etre reglee hors mode test", () => {
		delete process.env.MINIGAME_TEST_MODE;
		expect(() => horloge.regler(CIBLE)).toThrow();
	});

	it("deplace l'heure vue par les mini-jeux et laisse le temps s'ecouler", () => {
		process.env.MINIGAME_TEST_MODE = "true";
		horloge.regler(CIBLE);

		const ecart = horloge.maintenant().getTime() - CIBLE.getTime();
		expect(ecart).toBeGreaterThanOrEqual(0);
		expect(ecart).toBeLessThan(1000);
		expect(horloge.jourCourant()).toBe("2027-03-10");
		expect(horloge.estDecalee()).toBe(true);
	});

	it("place chaque etape juste apres son seuil, a l'heure de Paris", () => {
		const marge = horloge.MARGE_ETAPE_MS;
		// Mars 2027 : Paris en UTC+1 jusqu'au 28.
		expect(horloge.instantDeLEtape("2027-03-10", "publication", "09:00").getTime()).toBe(
			new Date("2027-03-09T23:00:00Z").getTime() + marge,
		);
		expect(horloge.instantDeLEtape("2027-03-10", "ping", "09:00").getTime()).toBe(
			new Date("2027-03-10T08:00:00Z").getTime() + marge,
		);
		expect(horloge.instantDeLEtape("2027-03-10", "fermeture", "09:00").getTime()).toBe(
			new Date("2027-03-10T23:00:00Z").getTime() + marge,
		);
	});
});

describe("commande de recette", () => {
	const avant = process.env.MINIGAME_TEST_MODE;
	afterEach(() => {
		if (avant === undefined) delete process.env.MINIGAME_TEST_MODE;
		else process.env.MINIGAME_TEST_MODE = avant;
	});

	it("n'est ni chargee ni publiee hors mode test", () => {
		delete process.env.MINIGAME_TEST_MODE;
		const commandes = loadCommands();
		expect(commandes.has("minijeu-test")).toBe(false);
		expect(commandes.has("devine")).toBe(true);
	});

	it("est chargee en mode test", () => {
		process.env.MINIGAME_TEST_MODE = "true";
		expect(loadCommands().has("minijeu-test")).toBe(true);
	});
});
