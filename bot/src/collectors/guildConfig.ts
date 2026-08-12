import prisma from "../prisma";

/**
 * Configuration cle/valeur par serveur (`config_guild`).
 *
 * Miroir cote bot de `api/src/guild-config/guild-config.service.ts`. Le bot
 * ecrit ici (ex. `/create_logs` qui y enregistre l'identifiant des salons de
 * logs crees), le dashboard lit et modifie via l'API — les deux passent par
 * la meme table, jamais l'un par l'autre.
 */

export async function getConfig(
	guildId: string,
	configName: string,
): Promise<string | null> {
	const row = await prisma.configGuild.findUnique({
		where: { guildId_configName: { guildId, configName } },
	});

	return row?.configValue ?? null;
}

export async function listConfig(guildId: string) {
	return prisma.configGuild.findMany({
		where: { guildId },
		orderBy: { configName: "asc" },
	});
}

export async function upsertConfig(
	guildId: string,
	configName: string,
	configValue: string,
	configDescription: string,
) {
	return prisma.configGuild.upsert({
		where: { guildId_configName: { guildId, configName } },
		update: { configValue, configDescription },
		create: { guildId, configName, configValue, configDescription },
	});
}

export async function deleteConfig(
	guildId: string,
	configName: string,
): Promise<void> {
	await prisma.configGuild.deleteMany({ where: { guildId, configName } });
}
