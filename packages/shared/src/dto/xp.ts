import { IsoDateString, PaginationQuery, Snowflake } from "./common";
import { MemberRef } from "./moderation";

/**
 * Contrats du module d'experience.
 *
 * L'XP est alimentee par le bot seul (`user_levels`), l'API ne fait que la
 * lire. Les paliers de recompense, eux, se reglent depuis le dashboard et sont
 * appliques par le bot — sans `discordSyncedAt` : un palier n'est pas un
 * evenement a rejouer une fois, c'est une regle permanente que le bot
 * reevalue a chaque montee de niveau et lors du rattrapage periodique.
 */

export interface XpLeaderboardRowDto {
	member: MemberRef;
	rank: number;
	xp: number;
	level: number;
	/** XP acquise depuis le debut du niveau courant. */
	xpIntoLevel: number;
	/** Largeur du niveau courant, en XP. */
	xpForLevel: number;
	/** Ce qu'il reste avant le niveau suivant. */
	xpToNextLevel: number;
	/** Avancement dans le niveau courant, entre 0 et 1. */
	ratio: number;
	/** Roles de palier deja merites a ce niveau. */
	rewardRoleIds: Snowflake[];
}

export interface XpLeaderboardQuery extends PaginationQuery {
	/** Filtre sur le nom ou l'identifiant Discord. */
	search?: string;
}

/** Reglages globaux, lus par la page pour situer un membre dans la courbe. */
export interface XpOverviewDto {
	/** Membres ayant au moins 1 XP. */
	rankedMemberCount: number;
	totalXp: number;
	/** Niveau le plus eleve atteint sur le serveur. */
	highestLevel: number;
	rewards: XpRewardRoleDto[];
}

export interface XpRewardRoleDto {
	id: string;
	guildId: Snowflake;
	roleId: Snowflake;
	/** Nom du role au referentiel, ou `null` s'il a ete supprime sur Discord. */
	roleName: string | null;
	/** Couleur Discord du role, pour l'afficher comme sur le serveur. */
	roleColor: number | null;
	level: number;
	replacePrevious: boolean;
	/** Membres ayant deja atteint ce palier. */
	eligibleMemberCount: number;
	createdAt: IsoDateString;
}

export interface CreateXpRewardRoleRequest {
	roleId: Snowflake;
	level: number;
	replacePrevious?: boolean;
}

export interface UpdateXpRewardRoleRequest {
	roleId?: Snowflake;
	level?: number;
	replacePrevious?: boolean;
}

/**
 * Palier le plus haut accepte.
 *
 * Au-dela, `xpRequiredForLevel` depasse le milliard d'XP : un palier que
 * personne n'atteindra jamais n'est pas un reglage, c'est une faute de frappe.
 */
export const MAX_XP_REWARD_LEVEL = 500;
