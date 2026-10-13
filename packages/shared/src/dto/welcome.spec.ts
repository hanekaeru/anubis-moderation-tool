import { DEFAULT_WELCOME_MESSAGES, renderWelcomeMessage } from "./welcome";

const CONTEXTE = {
	userId: "136122497891303425",
	displayName: "Hane",
	guildName: "Anubis",
	memberCount: 1204,
	boostCount: 7,
	alertRoleId: "900000000000000001",
};

describe("renderWelcomeMessage", () => {
	it("remplace tous les jetons", () => {
		expect(
			renderWelcomeMessage(
				"{membre} {pseudo} {serveur} {membres} {boosts} {moderation}",
				CONTEXTE,
			),
		).toBe(
			"<@136122497891303425> Hane Anubis 1204 7 <@&900000000000000001>",
		);
	});

	// L'annonce de boost existe pour que l'equipe donne le role bonus : sans la
	// mention du role dans le texte, personne n'est notifie.
	it("interpelle le role d'alerte dans l'annonce de boost par defaut", () => {
		expect(renderWelcomeMessage(DEFAULT_WELCOME_MESSAGES.BOOST, CONTEXTE)).toContain(
			"<@&900000000000000001>",
		);
	});

	it("rend {moderation} vide sans role choisi, sans laisser d'espace double", () => {
		const rendu = renderWelcomeMessage("Merci {membre} {moderation} !", {
			...CONTEXTE,
			alertRoleId: null,
		});
		expect(rendu).toBe("Merci <@136122497891303425> !");
	});
});
