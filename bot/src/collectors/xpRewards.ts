import type { Guild, GuildMember } from "discord.js";
import { levelFromXp, xpRequiredForLevel } from "@anubis/shared";
import type { XpRewardRole } from "@anubis/shared/prisma";
import prisma from "../prisma";

/**
 * Roles attribues automatiquement selon le niveau d'experience.
 *
 * Deux modes complementaires, comme le referentiel :
 *
 * - **au fil de l'eau** : `applyForMember` est appele a chaque montee de
 *   niveau, depuis `messageCreate` ;
 * - **par rattrapage** : `reconcileGuild` repasse periodiquement sur les
 *   membres deja eligibles.
 *
 * Le second n'est pas un filet de securite pour le premier — l'XP ne monte que
 * bot allume, une montee de niveau genere donc toujours son evenement. Il sert
 * a un cas que le premier ne peut pas couvrir : **un palier ajoute depuis le
 * dashboard**. Le niveau des membres concernes ne bougera peut-etre plus avant
 * des semaines, et sans rattrapage la nouvelle recompense ne serait distribuee
 * qu'a ceux qui progressent encore.
 */

/** Les paliers changent rarement : un cache court evite une requete par message. */
const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { rewards: XpRewardRole[]; expiresAt: number }>();

async function rewardsFor(guildId: string): Promise<XpRewardRole[]> {
	const cached = cache.get(guildId);
	if (cached && cached.expiresAt > Date.now()) return cached.rewards;

	const rewards = await prisma.xpRewardRole.findMany({
		where: { guildId },
		orderBy: { level: "asc" },
	});

	cache.set(guildId, { rewards, expiresAt: Date.now() + CACHE_TTL_MS });
	return rewards;
}

/** Vide le cache d'un serveur : utile aux tests et a un rechargement force. */
export function invalidateCache(guildId?: string): void {
	if (guildId) cache.delete(guildId);
	else cache.clear();
}

/**
 * Roles a poser et a retirer pour un niveau donne.
 *
 * `replacePrevious` porte sur le palier **atteint** : quand il est coche, les
 * roles des paliers inferieurs sont retires, pour une echelle ou un membre ne
 * porte qu'un seul rang a la fois. Le reglage est lu sur le palier le plus haut
 * merite, pas sur chacun : c'est lui qui decrit le rang courant du membre.
 */
export function resolveRoles(
	rewards: XpRewardRole[],
	level: number,
): { toAdd: string[]; toRemove: string[] } {
	const earned = rewards.filter((reward) => reward.level <= level);
	if (!earned.length) return { toAdd: [], toRemove: [] };

	const highest = earned[earned.length - 1]!;

	if (!highest.replacePrevious) {
		return { toAdd: earned.map((reward) => reward.roleId), toRemove: [] };
	}

	// Un meme role peut servir a deux paliers : ne jamais le retirer s'il est
	// aussi celui du palier courant.
	const lower = earned
		.slice(0, -1)
		.map((reward) => reward.roleId)
		.filter((roleId) => roleId !== highest.roleId);

	return { toAdd: [highest.roleId], toRemove: lower };
}

/**
 * Met les roles d'un membre en accord avec son niveau.
 *
 * Renvoie les roles reellement ajoutes, pour que l'appelant puisse en informer
 * le membre. Un role introuvable ou plus haut que le bot dans la hierarchie est
 * ignore sans faire echouer les autres : c'est un reglage a corriger sur
 * Discord, pas une panne.
 */
export async function applyForMember(
	member: GuildMember,
	level: number,
): Promise<string[]> {
	const rewards = await rewardsFor(member.guild.id);
	if (!rewards.length) return [];

	const { toAdd, toRemove } = resolveRoles(rewards, level);

	const missing = toAdd.filter((roleId) => !member.roles.cache.has(roleId));
	const extra = toRemove.filter((roleId) => member.roles.cache.has(roleId));

	const added: string[] = [];

	for (const roleId of missing) {
		const role = member.guild.roles.cache.get(roleId);
		// `comparePositionTo` plutot qu'un essai suivi d'une erreur : Discord
		// refuse tout role place au-dessus du plus haut role du bot, et
		// l'exception ne dit pas lequel des roles du lot a echoue.
		if (!role || role.comparePositionTo(member.guild.members.me!.roles.highest) >= 0) {
			continue;
		}

		try {
			await member.roles.add(role, `Palier d'expérience atteint (niveau ${level})`);
			added.push(roleId);
		} catch (err) {
			console.error(`[XP] Rôle ${roleId} non attribué à ${member.id} :`, err);
		}
	}

	for (const roleId of extra) {
		try {
			await member.roles.remove(roleId, "Remplacé par un palier supérieur");
		} catch (err) {
			console.error(`[XP] Rôle ${roleId} non retiré de ${member.id} :`, err);
		}
	}

	return added;
}

/**
 * Rattrape les paliers pour les membres deja eligibles.
 *
 * La requete part du **plus bas** palier : en dessous, aucun role n'est du, et
 * ramener toute la table d'XP pour n'en rien faire serait le plus gros cout de
 * la boucle. Les membres absents du cache ne sont pas cherches un par un — la
 * synchronisation complete du demarrage l'a rempli, et un membre parti n'a plus
 * de role a recevoir.
 */
export async function reconcileGuild(guild: Guild): Promise<void> {
	const rewards = await rewardsFor(guild.id);
	if (!rewards.length) return;

	const lowest = rewards[0]!;
	const threshold = BigInt(xpRequiredForLevel(lowest.level));

	const eligible = await prisma.userLevel.findMany({
		where: { guildId: guild.id, xp: { gte: threshold } },
		select: { userId: true, xp: true },
	});

	for (const row of eligible) {
		const member = guild.members.cache.get(row.userId);
		if (!member || member.user.bot) continue;

		try {
			await applyForMember(member, levelFromXp(Number(row.xp)));
		} catch (err) {
			console.error(`[XP] Rattrapage des paliers échoué pour ${row.userId} :`, err);
		}
	}
}
