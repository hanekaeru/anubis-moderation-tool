import type { GuildMember } from "discord.js";
import { hierarchyIssue } from "./moderationGuard";

function member(
	id: string,
	highestPosition: number,
	guild: { ownerId: string },
): GuildMember {
	return {
		id,
		guild,
		roles: { highest: { position: highestPosition } },
	} as unknown as GuildMember;
}

describe("hierarchyIssue", () => {
	it("refuse d'agir sur soi-meme", () => {
		const guild = { ownerId: "owner" };
		const actor = member("mod-1", 5, guild);
		expect(hierarchyIssue(actor, actor)).toMatch(/toi-meme/);
	});

	it("refuse d'agir sur le proprietaire du serveur", () => {
		const guild = { ownerId: "owner-1" };
		const actor = member("mod-1", 5, guild);
		const target = member("owner-1", 100, guild);
		expect(hierarchyIssue(actor, target)).toMatch(/proprietaire/);
	});

	it("refuse un auteur non-proprietaire visant un role egal ou superieur", () => {
		const guild = { ownerId: "owner-1" };
		const actor = member("mod-1", 5, guild);
		const equalTarget = member("member-1", 5, guild);
		const higherTarget = member("member-2", 10, guild);

		expect(hierarchyIssue(actor, equalTarget)).toMatch(/role egal ou superieur/);
		expect(hierarchyIssue(actor, higherTarget)).toMatch(/role egal ou superieur/);
	});

	it("autorise le proprietaire du serveur quelle que soit la position des roles", () => {
		const guild = { ownerId: "owner-1" };
		const actor = member("owner-1", 0, guild);
		const target = member("member-1", 100, guild);
		expect(hierarchyIssue(actor, target)).toBeNull();
	});

	it("autorise un auteur visant un role strictement inferieur", () => {
		const guild = { ownerId: "owner-1" };
		const actor = member("mod-1", 10, guild);
		const target = member("member-1", 5, guild);
		expect(hierarchyIssue(actor, target)).toBeNull();
	});
});
