import type { GuildMember } from "discord.js";

/**
 * Une permission Discord (KickMembers, BanMembers, ModerateMembers) n'empeche
 * pas d'agir sur un membre de rang egal ou superieur : Discord n'applique
 * cette hierarchie-la qu'entre le **bot** et la cible (`kickable`,
 * `bannable`, `moderatable`), jamais entre l'auteur de la commande et la
 * cible. Sans ce garde-fou, un moderateur pourrait sanctionner un collegue de
 * rang egal ou superieur du moment que le role du bot, lui, est assez haut.
 */
export function hierarchyIssue(
	actor: GuildMember,
	target: GuildMember,
): string | null {
	if (target.id === actor.id) {
		return "Impossible d'appliquer cette action à toi-même.";
	}

	if (target.id === actor.guild.ownerId) {
		return "Impossible d'agir sur le propriétaire du serveur.";
	}

	const actorIsOwner = actor.id === actor.guild.ownerId;
	if (
		!actorIsOwner &&
		target.roles.highest.position >= actor.roles.highest.position
	) {
		return "Ce membre a un rôle égal ou supérieur au tien.";
	}

	return null;
}
