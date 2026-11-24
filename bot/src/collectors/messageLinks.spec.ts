import {
	ChannelType,
	OverwriteType,
	PermissionFlagsBits,
	PermissionsBitField,
	type GuildBasedChannel,
	type GuildMember,
} from "discord.js";
import {
	MAX_LIENS_PAR_MESSAGE,
	audienceIncluse,
	auteurPeutVoir,
	extraireLiensDeMessages,
	permissionsDuRole,
	type RoleDuServeur,
	type Visibilite,
} from "./messageLinks";

const G = "111111111111111111";
const C = "222222222222222222";
const M = "333333333333333333";

describe("extraireLiensDeMessages", () => {
	it("reconnait les quatre domaines", () => {
		const contenu = [
			`https://discord.com/channels/${G}/${C}/${M}`,
			`https://ptb.discord.com/channels/${G}/${C}/444444444444444444`,
			`https://canary.discord.com/channels/${G}/${C}/555555555555555555`,
			`https://discordapp.com/channels/${G}/${C}/666666666666666666`,
		].join(" ");

		const liens = extraireLiensDeMessages(contenu, 10);
		expect(liens.map((l) => l.messageId)).toEqual([
			M,
			"444444444444444444",
			"555555555555555555",
			"666666666666666666",
		]);
		expect(liens[0]).toEqual({ guildId: G, channelId: C, messageId: M });
	});

	it("ignore les liens de salon sans message et les messages prives", () => {
		expect(
			extraireLiensDeMessages(
				`https://discord.com/channels/${G}/${C} https://discord.com/channels/@me/${C}/${M}`,
			),
		).toEqual([]);
	});

	it("ignore les domaines qui ne sont pas ceux de Discord", () => {
		expect(
			extraireLiensDeMessages(`https://evil-discord.com.example/channels/${G}/${C}/${M}`),
		).toEqual([]);
		expect(extraireLiensDeMessages(`https://discord.gg/channels/${G}/${C}/${M}`)).toEqual([]);
	});

	it("respecte un lien entre chevrons, sous spoiler ou dans du code", () => {
		const lien = `https://discord.com/channels/${G}/${C}/${M}`;
		expect(extraireLiensDeMessages(`<${lien}>`)).toEqual([]);
		expect(extraireLiensDeMessages(`regarde ||${lien}||`)).toEqual([]);
		expect(extraireLiensDeMessages(`\`${lien}\``)).toEqual([]);
		expect(extraireLiensDeMessages(`\`\`\`\n${lien}\n\`\`\``)).toEqual([]);
	});

	it("dedoublonne et plafonne", () => {
		const liens = Array.from(
			{ length: 6 },
			(_, i) => `https://discord.com/channels/${G}/${C}/${String(i).repeat(18)}`,
		);
		const contenu = [liens[0], liens[0], ...liens].join("\n");

		const extraits = extraireLiensDeMessages(contenu);
		expect(extraits).toHaveLength(MAX_LIENS_PAR_MESSAGE);
		expect(new Set(extraits.map((l) => l.messageId)).size).toBe(MAX_LIENS_PAR_MESSAGE);
	});

	it("n'accepte pas un identifiant tronque d'un nombre plus long", () => {
		expect(
			extraireLiensDeMessages(`https://discord.com/channels/${G}/${C}/${"9".repeat(25)}`),
		).toEqual([]);
	});
});

// ---------------------------------------------------------------------------

const VIEW = PermissionFlagsBits.ViewChannel;
const HISTORY = PermissionFlagsBits.ReadMessageHistory;
const LECTURE = VIEW | HISTORY;

const everyone: RoleDuServeur = { id: G, permissions: LECTURE | PermissionFlagsBits.SendMessages };
const staff: RoleDuServeur = { id: "700000000000000001", permissions: 0n };
const admin: RoleDuServeur = { id: "700000000000000002", permissions: PermissionFlagsBits.Administrator };
const roles = [staff, admin];

function salon(id: string, surcharges: Visibilite["surcharges"] = []): Visibilite {
	return { salonId: id, surcharges, filPriveId: null };
}

const general = salon("800000000000000001");
const autrePublic = salon("800000000000000002");
const salonStaff = salon("800000000000000003", [
	{ id: everyone.id, type: OverwriteType.Role, allow: 0n, deny: VIEW },
	{ id: staff.id, type: OverwriteType.Role, allow: VIEW, deny: 0n },
]);
const autreSalonStaff = salon("800000000000000004", [
	{ id: everyone.id, type: OverwriteType.Role, allow: 0n, deny: VIEW },
	{ id: staff.id, type: OverwriteType.Role, allow: VIEW, deny: 0n },
]);
const OUVREUR_A = "900000000000000001";
const OUVREUR_B = "900000000000000002";
function ticket(id: string, ouvreur: string): Visibilite {
	return salon(id, [
		{ id: everyone.id, type: OverwriteType.Role, allow: 0n, deny: VIEW },
		{ id: staff.id, type: OverwriteType.Role, allow: VIEW, deny: 0n },
		{ id: ouvreur, type: OverwriteType.Member, allow: LECTURE, deny: 0n },
	]);
}
const ticketA = ticket("800000000000000005", OUVREUR_A);
const ticketB = ticket("800000000000000006", OUVREUR_B);

/** Un ouvreur ne porte que @everyone : sa surcharge nominative fait le reste. */
function membreSansRole(membreId: string, vis: Visibilite): bigint {
	let permissions = permissionsDuRole(vis, everyone, everyone);
	const propre = vis.surcharges.find((s) => s.id === membreId);
	if (propre) permissions = (permissions & ~propre.deny) | propre.allow;
	return permissions;
}

describe("permissionsDuRole", () => {
	it("part des permissions de @everyone, que tout membre porte", () => {
		// Le role staff n'a aucune permission propre : sans @everyone, #general
		// lui paraitrait invisible.
		expect(permissionsDuRole(general, everyone, staff) & VIEW).toBe(VIEW);
	});

	it("applique la surcharge de @everyone puis celle du role", () => {
		expect(permissionsDuRole(salonStaff, everyone, everyone) & VIEW).toBe(0n);
		expect(permissionsDuRole(salonStaff, everyone, staff) & VIEW).toBe(VIEW);
	});

	it("donne tout a un administrateur, surcharges comprises", () => {
		expect(permissionsDuRole(salonStaff, everyone, admin)).toBe(PermissionsBitField.All);
	});
});

describe("audienceIncluse", () => {
	const inclus = (destination: Visibilite, source: Visibilite) =>
		audienceIncluse(destination, source, roles, everyone, membreSansRole);

	it("cite un salon public partout", () => {
		expect(inclus(autrePublic, general)).toBe(true);
		expect(inclus(salonStaff, general)).toBe(true);
	});

	it("ne cite pas un salon staff dans un salon public", () => {
		expect(inclus(general, salonStaff)).toBe(false);
	});

	it("cite un salon staff dans un autre salon staff", () => {
		expect(inclus(autreSalonStaff, salonStaff)).toBe(true);
	});

	it("ne cite pas un ticket dans un autre : l'ouvreur du second lirait le premier", () => {
		expect(inclus(ticketB, ticketA)).toBe(false);
	});

	it("cite un ticket dans un salon staff", () => {
		expect(inclus(salonStaff, ticketA)).toBe(true);
	});

	it("refuse quand un membre a surcharge nominative est introuvable", () => {
		// Hors cache, l'ouvreur du ticket pourrait tres bien voir la destination :
		// faute de le savoir, on ne cite pas.
		expect(audienceIncluse(ticketA, salonStaff, roles, everyone, () => null)).toBe(false);
	});

	it("ne cite un fil prive que dans ce fil", () => {
		const filPrive: Visibilite = { ...general, filPriveId: "800000000000000010" };
		expect(inclus(general, filPrive)).toBe(false);
		expect(inclus(filPrive, filPrive)).toBe(true);
	});

	it("cite le salon parent depuis l'un de ses fils", () => {
		const fil: Visibilite = { ...salonStaff, filPriveId: "800000000000000011" };
		expect(inclus(fil, salonStaff)).toBe(true);
	});
});

// ---------------------------------------------------------------------------

function fauxSalon(options: {
	permissions: bigint | null;
	type?: ChannelType;
	membresDuFil?: string[];
}): GuildBasedChannel {
	const membres = new Set(options.membresDuFil ?? []);
	return {
		type: options.type ?? ChannelType.GuildText,
		permissionsFor: () =>
			options.permissions === null ? null : new PermissionsBitField(options.permissions),
		members: {
			cache: new Map([...membres].map((id) => [id, { id }])),
			fetch: jest.fn().mockRejectedValue(new Error("Unknown Member")),
		},
	} as unknown as GuildBasedChannel;
}

const auteur = { id: "900000000000000099" } as GuildMember;

describe("auteurPeutVoir", () => {
	it("exige de voir le salon et d'en lire l'historique", async () => {
		expect(await auteurPeutVoir(fauxSalon({ permissions: LECTURE }), auteur)).toBe(true);
		expect(await auteurPeutVoir(fauxSalon({ permissions: VIEW }), auteur)).toBe(false);
		expect(await auteurPeutVoir(fauxSalon({ permissions: HISTORY }), auteur)).toBe(false);
		expect(await auteurPeutVoir(fauxSalon({ permissions: null }), auteur)).toBe(false);
	});

	it("exige d'etre membre d'un fil prive", async () => {
		const fil = { permissions: LECTURE, type: ChannelType.PrivateThread };
		expect(await auteurPeutVoir(fauxSalon(fil), auteur)).toBe(false);
		expect(
			await auteurPeutVoir(fauxSalon({ ...fil, membresDuFil: [auteur.id] }), auteur),
		).toBe(true);
	});

	it("laisse passer qui gere les fils, membre ou non", async () => {
		expect(
			await auteurPeutVoir(
				fauxSalon({
					permissions: LECTURE | PermissionFlagsBits.ManageThreads,
					type: ChannelType.PrivateThread,
				}),
				auteur,
			),
		).toBe(true);
	});
});
