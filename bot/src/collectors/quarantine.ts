import type { Client, Guild, GuildMember, Role } from "discord.js";
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

/** Ce que la levee a besoin de savoir du reglage, et rien de plus. */
type ReglageLevee = {
	roleId: string | null;
	releaseAddRoleIds: string[];
	releaseRemoveRoleIds: string[];
};

/**
 * Un role n'est modifiable que s'il n'est ni gere par une integration (role de
 * bot, role de boost) ni place au-dessus du plus haut role du bot. Meme regle
 * que `partitionRoles` du shadowban, et pour la meme raison : `roles.set` est
 * un appel unique, un seul role interdit ferait echouer la levee entiere.
 */
function gerable(role: Role | null | undefined, botHighest: Role | null): boolean {
	if (!role) return false;
	return (
		!role.managed && botHighest !== null && role.comparePositionTo(botHighest) < 0
	);
}

/**
 * Applique la levee : role de quarantaine retire, roles configures poses et
 * retires, en **un seul** `roles.set`.
 *
 * Un `remove` suivi d'un `add` ferait traverser au membre un etat ou il a
 * quitte la quarantaine sans avoir encore le role qui ouvre le serveur — un
 * arrivant y verrait un serveur vide pendant le temps d'un aller-retour reseau,
 * et un echec entre les deux appels l'y laisserait pour de bon.
 *
 * Un role que le bot ne peut pas modifier est **ignore, pas fatal** : la levee
 * doit aboutir meme si un role de la liste a depuis ete deplace au-dessus du
 * bot. Le journal le signale, car un role configure qui ne s'applique jamais
 * passerait autrement pour un bug du bouton.
 */
export async function appliquerRolesDeLevee(
	member: GuildMember,
	config: ReglageLevee,
	raison: string,
): Promise<void> {
	const botHighest = member.guild.members.me?.roles.highest ?? null;

	const aRetirer = new Set<string>(config.releaseRemoveRoleIds);
	if (config.roleId) aRetirer.add(config.roleId);

	const final = new Set<string>();

	for (const role of member.roles.cache.values()) {
		// `@everyone` porte l'identifiant du serveur et n'est jamais transmis.
		if (role.id === member.guild.id) continue;

		if (aRetirer.has(role.id)) {
			// Hors de portee du bot : on le laisse dans le lot pour que Discord n'y
			// voie aucun changement, plutot que de faire echouer l'appel entier.
			if (!gerable(role, botHighest)) {
				console.warn(
					`[Quarantaine] Rôle ${role.id} non retirable à ${member.id} (géré ou au-dessus du bot).`,
				);
				final.add(role.id);
			}
			continue;
		}

		final.add(role.id);
	}

	for (const roleId of config.releaseAddRoleIds) {
		if (aRetirer.has(roleId)) continue;

		const role =
			member.guild.roles.cache.get(roleId) ??
			(await member.guild.roles.fetch(roleId).catch(() => null));

		if (!gerable(role, botHighest)) {
			console.warn(
				`[Quarantaine] Rôle ${roleId} non attribuable à ${member.id} (introuvable, géré ou au-dessus du bot).`,
			);
			continue;
		}

		final.add(roleId);
	}

	await member.roles.set([...final], raison);
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

	await appliquerRolesDeLevee(member, config, "Règlement accepté.");

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

	await appliquerRolesDeLevee(
		member,
		config,
		"Quarantaine levée depuis le dashboard.",
	);
}
