import { lienVerificationBattlenet } from "./verificationLink";

const STATE = "b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5";

describe("lienVerificationBattlenet", () => {
	it("compose le lien de depart avec le state", () => {
		expect(lienVerificationBattlenet("https://anubis.exemple.fr/api", STATE)).toBe(
			`https://anubis.exemple.fr/api/verification/battlenet/start?state=${STATE}`,
		);
	});

	// Sans la barre finale ajoutee a la base, `new URL` remplacerait `/api` au
	// lieu de s'y ajouter — le lien pointerait a la racine du domaine.
	it("conserve le prefixe de chemin de la base", () => {
		const lien = lienVerificationBattlenet("https://anubis.exemple.fr/api", STATE);

		expect(lien).toContain("/api/verification/");
	});

	it("tolere une barre finale et des espaces", () => {
		expect(lienVerificationBattlenet("  https://anubis.exemple.fr/api/  ", STATE)).toBe(
			`https://anubis.exemple.fr/api/verification/battlenet/start?state=${STATE}`,
		);
	});

	it("accepte localhost, avec ou sans port", () => {
		expect(lienVerificationBattlenet("http://localhost:3000/api", STATE)).toContain(
			"http://localhost:3000/api/verification/",
		);
	});

	describe("refus", () => {
		// Chacun de ces cas passe `new URL()` sans erreur et se fait refuser par
		// Discord avec un `50035` qui ne nomme pas la valeur fautive. C'est
		// exactement la panne qu'il faut attraper avant l'envoi.
		it.each([
			["variable absente", undefined],
			["chaine vide", ""],
			["espaces seuls", "   "],
			// `https://${APP_DOMAIN}/api` avec APP_DOMAIN vide.
			["domaine vide", "https:///api"],
			// La meme, non substituee du tout.
			["variable non substituee", "https://${APP_DOMAIN}/api"],
			// APP_DOMAIN contenant deja le protocole.
			["protocole en double", "https://https://anubis.exemple.fr/api"],
			["protocole absent", "anubis.exemple.fr/api"],
			["protocole non http", "ftp://anubis.exemple.fr/api"],
		])("rend null : %s", (_libelle, base) => {
			expect(lienVerificationBattlenet(base, STATE)).toBeNull();
		});
	});
});
