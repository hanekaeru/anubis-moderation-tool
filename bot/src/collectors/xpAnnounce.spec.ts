import { XpAnnouncementMode } from "@anubis/shared";
import { buildContent, type LevelUpAnnouncement } from "./xpAnnounce";

function announcement(
	overrides: Partial<LevelUpAnnouncement> = {},
): LevelUpAnnouncement {
	return {
		member: {
			id: "42",
			displayName: "Nout",
			guild: { name: "Anubis" },
		},
		level: 10,
		earnedRoleIds: [],
		origin: {},
		...overrides,
	} as unknown as LevelUpAnnouncement;
}

describe("buildContent", () => {
	it("mentionne le membre quand la mention est active", () => {
		const content = buildContent(
			{
				mode: XpAnnouncementMode.CURRENT_CHANNEL,
				message: null,
				pingMember: true,
			},
			announcement(),
		);

		expect(content).toBe("🎉 Bravo <@42>, tu passes **niveau 10** !");
	});

	// Mention coupee, le nom reste lisible : l'annonce doit continuer a dire de
	// qui elle parle, sans faire sonner le telephone de l'interesse.
	it("cite le nom affiche quand la mention est coupee", () => {
		const content = buildContent(
			{
				mode: XpAnnouncementMode.CURRENT_CHANNEL,
				message: null,
				pingMember: false,
			},
			announcement(),
		);

		expect(content).toBe("🎉 Bravo Nout, tu passes **niveau 10** !");
	});

	it("nomme le serveur dans le texte par defaut du message prive", () => {
		const content = buildContent(
			{
				mode: XpAnnouncementMode.DIRECT_MESSAGE,
				message: null,
				pingMember: true,
			},
			announcement(),
		);

		expect(content).toBe("🎉 Bravo, tu passes **niveau 10** sur **Anubis** !");
	});

	it("annonce les roles de palier obtenus", () => {
		const content = buildContent(
			{
				mode: XpAnnouncementMode.CURRENT_CHANNEL,
				message: null,
				pingMember: true,
			},
			announcement({ earnedRoleIds: ["7", "8"] }),
		);

		expect(content).toContain("Tu débloques <@&7>, <@&8> !");
	});

	it("prefere le gabarit du serveur au texte par defaut", () => {
		const content = buildContent(
			{
				mode: XpAnnouncementMode.DEDICATED_CHANNEL,
				message: "{membre} → niveau {niveau} sur {serveur}",
				pingMember: false,
			},
			announcement(),
		);

		expect(content).toBe("Nout → niveau 10 sur Anubis");
	});
});
