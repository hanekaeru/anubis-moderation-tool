import { PermissionFlagsBits, type GuildMember } from "discord.js";
import prisma from "../prisma";

/**
 * Reglages vocaux du serveur.
 *
 * Aujourd'hui une seule chose : qui un proprietaire de salon temporaire ne
 * peut pas expulser. Le bouton « Expulser » du panneau laissait sinon un
 * membre sortir un moderateur de son propre salon — exactement ce que la
 * moderation vient y faire.
 *
 * Cache de 30 secondes, comme l'automod et les mentions : la liste est lue a
 * chaque ouverture du select d'expulsion, et un reglage change depuis le
 * dashboard doit valoir sans redemarrage.
 */

const CACHE_MS = 30_000;

const cache = new Map<string, { roles: string[]; expire: number }>();

export async function rolesProteges(guildId: string): Promise<string[]> {
	const connu = cache.get(guildId);
	if (connu && connu.expire > Date.now()) return connu.roles;

	const ligne = await prisma.voiceConfig.findUnique({ where: { guildId } });
	const roles = ligne?.protectedRoleIds ?? [];

	cache.set(guildId, { roles, expire: Date.now() + CACHE_MS });
	return roles;
}

/** A appeler apres une ecriture du bot lui-meme sur ce reglage. */
export function oublierReglages(guildId: string): void {
	cache.delete(guildId);
}

/**
 * Un membre que le proprietaire ne peut pas sortir de son salon.
 *
 * Deux raisons, et la premiere ne se configure pas : **tout porteur de
 * `ModerateMembers` est protege**, parce que c'est deja le marqueur qui donne
 * l'acces aux salons de ticket et qui ouvre `/warn` et `/ban`. Sans ce defaut,
 * la protection ne vaudrait rien tant que personne n'aurait rempli la liste —
 * or le probleme existe des le premier salon cree.
 *
 * La liste du dashboard couvre le reste : un role a proteger sans lui donner
 * de pouvoir de moderation.
 */
export async function estProtege(membre: GuildMember): Promise<boolean> {
	if (membre.permissions.has(PermissionFlagsBits.ModerateMembers)) return true;

	const proteges = await rolesProteges(membre.guild.id);
	return proteges.some((roleId) => membre.roles.cache.has(roleId));
}
