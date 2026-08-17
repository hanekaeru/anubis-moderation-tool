import type { Client, Guild, GuildMember } from "discord.js";
import prisma from "../prisma";

/**
 * Quarantaine a l'arrivee.
 *
 * Un role de quarantaine est attribue a chaque nouveau membre et retire quand
 * il accepte le reglement, en cliquant sur le bouton pose par
 * `/quarantaine-message`. Aucune expulsion automatique : la quarantaine dure
 * jusqu'a l'acceptation, ou jusqu'a une levee manuelle depuis la webapp.
 *
 * Meme patron `discordSyncedAt` que l'anti-raid : une levee decidee par le bot
 * lui-meme (le clic) est marquee synchronisee immediatement, une levee venue de
 * la webapp reste a `null` jusqu'au prochain passage de `checkPendingReleases`.
 */

export type ResultatAcceptation = "acceptee" | "deja-acceptee" | "hors-service";

async function configActive(guildId: string) {
	const config = await prisma.quarantineConfig.findUnique({
		where: { guildId },
	});
	if (!config?.enabled || !config.roleId) return null;
	return config;
}

/** Attribue le role de quarantaine a un membre qui vient d'arriver. */
export async function quarantineNewMember(member: GuildMember): Promise<void> {
	const config = await configActive(member.guild.id);
	if (!config?.roleId) return;

	await member.roles.add(config.roleId, "Quarantaine à l'arrivée.");

	// Un membre deja connu qui revient repart en quarantaine : ses roles
	// Discord ont disparu avec son depart, l'acceptation precedente ne vaut
	// plus rien.
	await prisma.quarantineStatus.upsert({
		where: {
			guildId_userId: { guildId: member.guild.id, userId: member.id },
		},
		update: {
			quarantinedAt: new Date(),
			acceptedAt: null,
			releasedById: null,
			discordSyncedAt: new Date(),
		},
		create: {
			guildId: member.guild.id,
			userId: member.id,
			// Le role vient d'etre pose par cet appel : rien a rattraper.
			discordSyncedAt: new Date(),
		},
	});
}

/**
 * Acceptation du reglement par le membre lui-meme (bouton).
 *
 * Le role est retire ici, donc `discordSyncedAt` est pose dans la foulee.
 */
export async function accepterReglement(
	member: GuildMember,
): Promise<ResultatAcceptation> {
	const config = await configActive(member.guild.id);
	if (!config?.roleId) return "hors-service";

	const statut = await prisma.quarantineStatus.findUnique({
		where: {
			guildId_userId: { guildId: member.guild.id, userId: member.id },
		},
	});

	// Sans role de quarantaine ni statut ouvert, il n'y a rien a lever : le
	// membre a deja accepte, ou n'a jamais ete mis en quarantaine.
	if (!member.roles.cache.has(config.roleId) && statut?.acceptedAt) {
		return "deja-acceptee";
	}

	await member.roles.remove(config.roleId, "Règlement accepte.");

	const maintenant = new Date();
	await prisma.quarantineStatus.upsert({
		where: {
			guildId_userId: { guildId: member.guild.id, userId: member.id },
		},
		update: { acceptedAt: maintenant, discordSyncedAt: maintenant },
		create: {
			guildId: member.guild.id,
			userId: member.id,
			acceptedAt: maintenant,
			discordSyncedAt: maintenant,
		},
	});

	return "acceptee";
}

/**
 * Levees demandees depuis la webapp, pas encore rejouees cote Discord.
 *
 * Le membre peut avoir quitte le serveur entre-temps : l'entree est alors
 * marquee synchronisee malgre tout, sinon elle reviendrait a chaque passage.
 */
export async function checkPendingReleases(client: Client): Promise<void> {
	const pending = await prisma.quarantineStatus.findMany({
		where: { acceptedAt: { not: null }, discordSyncedAt: null },
	});

	for (const statut of pending) {
		const guild = client.guilds.cache.get(statut.guildId);
		if (!guild) continue;

		try {
			await retirerRole(guild, statut.userId);

			await prisma.quarantineStatus.update({
				where: {
					guildId_userId: {
						guildId: statut.guildId,
						userId: statut.userId,
					},
				},
				data: { discordSyncedAt: new Date() },
			});
		} catch (err) {
			console.error(
				`[Quarantaine] Levée de ${statut.userId} échouée :`,
				err,
			);
		}
	}
}

async function retirerRole(guild: Guild, userId: string): Promise<void> {
	const config = await prisma.quarantineConfig.findUnique({
		where: { guildId: guild.id },
	});
	if (!config?.roleId) return;

	const member = await guild.members.fetch(userId).catch(() => null);
	if (!member) return;

	await member.roles.remove(config.roleId, "Quarantaine levée depuis le dashboard.");
}
