jest.mock("../prisma", () => ({ __esModule: true, default: {} }));
jest.mock("../collectors/voice", () => ({ __esModule: true }));
jest.mock("../collectors/voiceHubs", () => ({ __esModule: true }));
jest.mock("../collectors/voiceLog", () => ({ __esModule: true }));

import { lirePlaces } from "./voiceInteractions";

/**
 * Lecture des places declarees dans la modale de personnalisation.
 *
 * Trois regles s'y croisent et aucune n'est devinable a la lecture du rendu :
 * un role absent de la composition n'a pas de champ, tout vide efface la ligne
 * des roles, et une place au-dela du total est refusee plutot que ramenee au
 * plafond.
 */

const COMPOSITION = { tankSlots: 2, dpsSlots: 2, supportSlots: 2 };

function modale(saisies: Record<string, string>) {
	return {
		fields: {
			getTextInputValue: (customId: string) => {
				const valeur = saisies[customId];
				// Discord ne livre pas un champ absent de la modale : le lire
				// leverait une erreur, exactement comme ici.
				if (valeur === undefined) {
					throw new Error(`champ absent : ${customId}`);
				}
				return valeur;
			},
		},
	} as never;
}

describe("lirePlaces", () => {
	it("lit les trois nombres", () => {
		const resultat = lirePlaces(
			modale({ tank: "1", dps: "2", support: "0" }),
			COMPOSITION,
		);

		expect(resultat).toEqual({
			valeurs: { tankTaken: 1, dpsTaken: 2, supportTaken: 0 },
		});
	});

	// Le seul chemin de retour vers un sujet sans composition : sans lui, le
	// premier remplissage serait definitif.
	it("efface la ligne des roles quand tout est vide", () => {
		expect(lirePlaces(modale({ tank: "", dps: "", support: "" }), COMPOSITION)).toEqual({
			valeurs: { tankTaken: null, dpsTaken: null, supportTaken: null },
		});
	});

	// La ligne s'affiche en entier ou pas du tout : un champ vide a cote d'un
	// champ rempli vaut zero, pas « inconnu ».
	it("compte zero pour un champ laisse vide a cote d'un autre rempli", () => {
		expect(lirePlaces(modale({ tank: "1", dps: "", support: "" }), COMPOSITION)).toEqual({
			valeurs: { tankTaken: 1, dpsTaken: 0, supportTaken: 0 },
		});
	});

	// Ramener « 3 » a « 2 » en silence afficherait un chiffre que personne n'a
	// saisi, alors que c'est une faute de frappe.
	it("refuse une place au-dela du total plutot que de la ramener au plafond", () => {
		const resultat = lirePlaces(
			modale({ tank: "3", dps: "2", support: "2" }),
			COMPOSITION,
		);

		expect(resultat).toEqual({ erreur: expect.stringContaining("entre 0 et 2") });
	});

	it("refuse une saisie qui n'est pas un nombre entier", () => {
		expect(
			lirePlaces(modale({ tank: "un", dps: "2", support: "2" }), COMPOSITION),
		).toEqual({ erreur: expect.stringContaining("Tank") });

		expect(
			lirePlaces(modale({ tank: "-1", dps: "2", support: "2" }), COMPOSITION),
		).toEqual({ erreur: expect.any(String) });
	});

	// Un role regle a zero place n'a pas de champ dans la modale : le lire
	// quand meme ferait echouer toute la soumission.
	it("ne lit pas le champ d'un role absent de la composition", () => {
		const resultat = lirePlaces(modale({ dps: "2", support: "1" }), {
			...COMPOSITION,
			tankSlots: 0,
		});

		expect(resultat).toEqual({
			valeurs: { tankTaken: null, dpsTaken: 2, supportTaken: 1 },
		});
	});
});
