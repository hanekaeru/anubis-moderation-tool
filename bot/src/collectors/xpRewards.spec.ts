import { resolveRoles } from "./xpRewards";

function reward(
	level: number,
	roleId: string,
	replacePrevious = false,
): Parameters<typeof resolveRoles>[0][number] {
	return {
		id: `reward-${level}`,
		guildId: "1",
		roleId,
		level,
		replacePrevious,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

describe("resolveRoles", () => {
	const ladder = [
		reward(5, "role-5"),
		reward(10, "role-10"),
		reward(20, "role-20"),
	];

	it("ne donne rien en dessous du premier palier", () => {
		expect(resolveRoles(ladder, 4)).toEqual({ toAdd: [], toRemove: [] });
	});

	it("cumule les paliers merites par defaut", () => {
		expect(resolveRoles(ladder, 12)).toEqual({
			toAdd: ["role-5", "role-10"],
			toRemove: [],
		});
	});

	// `replacePrevious` se lit sur le palier atteint, pas sur chacun : c'est lui
	// qui decrit le rang courant du membre.
	it("retire les paliers inferieurs quand le palier atteint remplace", () => {
		const exclusive = [
			reward(5, "role-5"),
			reward(10, "role-10", true),
			reward(20, "role-20"),
		];

		expect(resolveRoles(exclusive, 12)).toEqual({
			toAdd: ["role-10"],
			toRemove: ["role-5"],
		});
	});

	it("cumule a nouveau si le palier suivant ne remplace pas", () => {
		const exclusive = [
			reward(5, "role-5"),
			reward(10, "role-10", true),
			reward(20, "role-20"),
		];

		expect(resolveRoles(exclusive, 25)).toEqual({
			toAdd: ["role-5", "role-10", "role-20"],
			toRemove: [],
		});
	});

	// Un meme role peut servir a deux paliers : le retirer serait retirer celui
	// qu'on vient d'attribuer.
	it("ne retire jamais le role du palier courant", () => {
		const repeated = [reward(5, "role-vip"), reward(10, "role-vip", true)];

		expect(resolveRoles(repeated, 10)).toEqual({
			toAdd: ["role-vip"],
			toRemove: [],
		});
	});
});
