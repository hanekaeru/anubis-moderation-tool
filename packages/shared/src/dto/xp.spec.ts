import { XpAnnouncementMode } from "../enums";
import {
	DEFAULT_XP_LEVEL_UP_MESSAGE,
	DEFAULT_XP_LEVEL_UP_DIRECT_MESSAGE,
	defaultXpLevelUpMessage,
	renderXpLevelUpMessage,
} from "./xp";

const context = {
	member: "<@42>",
	level: 10,
	guildName: "Anubis",
	roleMentions: [] as string[],
};

describe("renderXpLevelUpMessage", () => {
	it("remplace les substitutions", () => {
		expect(
			renderXpLevelUpMessage("{membre} atteint {niveau} sur {serveur}", context),
		).toBe("<@42> atteint 10 sur Anubis");
	});

	// La phrase entiere disparait, pas seulement la liste : c'est ce qui evite
	// une etiquette orpheline quand la montee de niveau ne debloque rien.
	it("efface la phrase de recompense sans role obtenu", () => {
		expect(renderXpLevelUpMessage("Niveau {niveau} !{recompenses}", context)).toBe(
			"Niveau 10 !",
		);
	});

	it("enumere les roles obtenus", () => {
		expect(
			renderXpLevelUpMessage("Niveau {niveau} !{recompenses}", {
				...context,
				roleMentions: ["<@&1>", "<@&2>"],
			}),
		).toBe("Niveau 10 ! Tu débloques <@&1>, <@&2> !");
	});

	it("remplace toutes les occurrences d'une meme substitution", () => {
		expect(renderXpLevelUpMessage("{niveau} — {niveau}", context)).toBe("10 — 10");
	});

	// Le gabarit vient du dashboard : une substitution inconnue doit rester
	// lisible telle quelle plutot que de faire echouer l'annonce.
	it("laisse intacte une substitution inconnue", () => {
		expect(renderXpLevelUpMessage("{inconnu} {niveau}", context)).toBe(
			"{inconnu} 10",
		);
	});
});

describe("defaultXpLevelUpMessage", () => {
	it("nomme le serveur en message prive, ou le salon ne le dit plus", () => {
		expect(defaultXpLevelUpMessage(XpAnnouncementMode.DIRECT_MESSAGE)).toBe(
			DEFAULT_XP_LEVEL_UP_DIRECT_MESSAGE,
		);
		expect(
			renderXpLevelUpMessage(
				defaultXpLevelUpMessage(XpAnnouncementMode.DIRECT_MESSAGE),
				context,
			),
		).toContain("Anubis");
	});

	it("garde le texte historique pour les annonces publiques", () => {
		for (const mode of [
			XpAnnouncementMode.CURRENT_CHANNEL,
			XpAnnouncementMode.DEDICATED_CHANNEL,
		]) {
			expect(defaultXpLevelUpMessage(mode)).toBe(DEFAULT_XP_LEVEL_UP_MESSAGE);
		}

		expect(
			renderXpLevelUpMessage(DEFAULT_XP_LEVEL_UP_MESSAGE, {
				...context,
				roleMentions: ["<@&7>"],
			}),
		).toBe("🎉 Bravo <@42>, tu passes **niveau 10** ! Tu débloques <@&7> !");
	});
});
