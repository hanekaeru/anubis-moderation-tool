import {
	DEFAULT_VOICE_STATUS_PATTERN,
	MAX_VOICE_STATUS_LENGTH,
	renderVoiceStatus,
} from "./voice";

describe("renderVoiceStatus", () => {
	const rank = { label: "Or", emoji: "🥇" };
	const platform = { label: "PC", emoji: null };

	it("compose rang, plateforme et sujet", () => {
		expect(
			renderVoiceStatus(DEFAULT_VOICE_STATUS_PATTERN, {
				rank,
				platform,
				topic: "cherche un support",
			}),
		).toBe("🥇 Or PC · cherche un support");
	});

	// Un salon n'a ni rang ni plateforme tant que le proprietaire n'a rien
	// choisi : le gabarit doit alors se reduire proprement, sans laisser
	// trainer le separateur qui les precede.
	it("retire les separateurs restes orphelins", () => {
		expect(
			renderVoiceStatus(DEFAULT_VOICE_STATUS_PATTERN, {
				topic: "cherche un support",
			}),
		).toBe("cherche un support");

		expect(
			renderVoiceStatus(DEFAULT_VOICE_STATUS_PATTERN, { rank, platform }),
		).toBe("🥇 Or PC");

		expect(
			renderVoiceStatus(DEFAULT_VOICE_STATUS_PATTERN, { rank, topic: "duo" }),
		).toBe("🥇 Or · duo");
	});

	it("rend une chaine vide quand rien n'est choisi", () => {
		expect(renderVoiceStatus(DEFAULT_VOICE_STATUS_PATTERN, {})).toBe("");
	});

	it("borne le resultat au plafond de Discord", () => {
		const long = renderVoiceStatus("{sujet}", { topic: "a".repeat(900) });
		expect(long.length).toBe(MAX_VOICE_STATUS_LENGTH);
	});
});
