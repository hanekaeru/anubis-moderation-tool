import {
	DEFAULT_VOICE_STATUS_PATTERN,
	DEFAULT_VOICE_TEAM_EMOJIS,
	MAX_VOICE_STATUS_LENGTH,
	renderVoiceStatus,
	voiceTeamSlots,
} from "./voice";

const COMPOSITION = {
	tankSlots: 2,
	dpsSlots: 2,
	supportSlots: 2,
	tankEmoji: "🛡️",
	dpsEmoji: "⚔️",
	supportEmoji: "💉",
};

describe("voiceTeamSlots", () => {
	// Un salon qui vient de naitre n'annonce pas une equipe vide : il n'annonce
	// rien, exactement comme il n'annonce ni rang ni plateforme.
	it("ne rend rien tant qu'aucune place n'est declaree", () => {
		expect(
			voiceTeamSlots(COMPOSITION, {
				tankTaken: null,
				dpsTaken: null,
				supportTaken: null,
			}),
		).toBeNull();
	});

	it("traite une place absente comme zero des qu'une autre est posee", () => {
		const team = voiceTeamSlots(COMPOSITION, {
			tankTaken: 1,
			dpsTaken: null,
			supportTaken: null,
		});

		expect(team?.tank).toEqual({ emoji: "🛡️", taken: 1, total: 2 });
		expect(team?.dps.taken).toBe(0);
	});

	it("retombe sur l'emoji de repli quand le salon de creation n'en pose pas", () => {
		const team = voiceTeamSlots(
			{ ...COMPOSITION, tankEmoji: null, dpsEmoji: "", supportEmoji: null },
			{ tankTaken: 0, dpsTaken: 0, supportTaken: 0 },
		);

		expect(team?.tank.emoji).toBe(DEFAULT_VOICE_TEAM_EMOJIS.tank);
		// Une chaine vide n'est pas un emoji pose : meme repli que `null`.
		expect(team?.dps.emoji).toBe(DEFAULT_VOICE_TEAM_EMOJIS.dps);
	});
});

describe("renderVoiceStatus", () => {
	const rank = { label: "Or", emoji: "🥇" };
	const platform = { label: "PC", emoji: null };
	const team = voiceTeamSlots(COMPOSITION, {
		tankTaken: 1,
		dpsTaken: 2,
		supportTaken: 0,
	});

	it("compose rang, plateforme et places", () => {
		expect(
			renderVoiceStatus(DEFAULT_VOICE_STATUS_PATTERN, { rank, platform, team }),
		).toBe("🥇 Or PC · 🛡️ 1/2 · ⚔️ 2/2 · 💉 0/2");
	});

	// Un role sans place dans la composition ne doit pas s'afficher « 0/0 »,
	// qui se lirait comme une equipe complete.
	it("omet un role que le salon de creation ne propose pas", () => {
		const sansTank = voiceTeamSlots(
			{ ...COMPOSITION, tankSlots: 0 },
			{ tankTaken: 0, dpsTaken: 1, supportTaken: 1 },
		);

		expect(renderVoiceStatus("{roles}", { team: sansTank })).toBe(
			"⚔️ 1/2 · 💉 1/2",
		);
	});

	// Un salon n'a ni rang ni plateforme tant que le proprietaire n'a rien
	// choisi : le gabarit doit alors se reduire proprement, sans laisser
	// trainer le separateur qui les precede.
	it("retire les separateurs restes orphelins", () => {
		expect(renderVoiceStatus(DEFAULT_VOICE_STATUS_PATTERN, { team })).toBe(
			"🛡️ 1/2 · ⚔️ 2/2 · 💉 0/2",
		);

		expect(
			renderVoiceStatus(DEFAULT_VOICE_STATUS_PATTERN, { rank, platform }),
		).toBe("🥇 Or PC");

		expect(renderVoiceStatus(DEFAULT_VOICE_STATUS_PATTERN, { rank, team })).toBe(
			"🥇 Or · 🛡️ 1/2 · ⚔️ 2/2 · 💉 0/2",
		);
	});

	it("rend une chaine vide quand rien n'est choisi", () => {
		expect(renderVoiceStatus(DEFAULT_VOICE_STATUS_PATTERN, {})).toBe("");
	});

	// Le sujet d'un salon est court : pouvoir retirer les libelles sans perdre
	// l'information est ce qui permet d'y faire tenir la composition.
	describe("jetons reduits a l'icone", () => {
		it("rend la seule icone", () => {
			expect(
				renderVoiceStatus("{rang-icone} {plateforme-icone}", { rank, platform: { label: "PC", emoji: "🖥️" } }),
			).toBe("🥇 🖥️");
		});

		it("se melange avec la forme complete", () => {
			expect(
				renderVoiceStatus("{rang} · {plateforme-icone}", { rank, platform: { label: "PC", emoji: "🖥️" } }),
			).toBe("🥇 Or · 🖥️");
		});

		// Rendre vide serait coherent avec le nom du jeton, mais ferait
		// disparaitre le rang sans que personne ne comprenne pourquoi.
		it("retombe sur le libelle quand l'option n'a pas d'emoji", () => {
			expect(renderVoiceStatus("{rang-icone}", { rank: { label: "Or", emoji: null } })).toBe("Or");
		});

		it("reste vide quand l'option elle-meme est absente", () => {
			expect(renderVoiceStatus("{rang-icone} · {roles}", { team })).toBe(
				"🛡️ 1/2 · ⚔️ 2/2 · 💉 0/2",
			);
		});

		// `{rang}` n'est pas un sous-ensemble de `{rang-icone}` : les deux jetons
		// sont independants, et l'ordre de substitution n'a pas a etre garde.
		it("ne laisse aucun fragment de jeton derriere lui", () => {
			const rendu = renderVoiceStatus("{rang-icone}{plateforme-icone}{rang}{plateforme}", {
				rank,
				platform,
			});
			expect(rendu).not.toContain("{");
			expect(rendu).not.toContain("icone}");
		});
	});

	// Le texte libre a disparu, mais un gabarit modifie a la main depuis le
	// dashboard peut encore porter son jeton : il ne doit rien afficher.
	it("rend vide l'ancien jeton de sujet libre", () => {
		expect(renderVoiceStatus("{rang} · {sujet}", { rank })).toBe("🥇 Or");
	});

	it("borne le resultat au plafond de Discord", () => {
		const long = renderVoiceStatus(`{rang} ${"a".repeat(900)}`, { rank });
		expect(long.length).toBe(MAX_VOICE_STATUS_LENGTH);
	});
});
