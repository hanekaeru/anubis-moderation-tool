import { XpAnnouncementMode } from "../enums";
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
	/** Annonce des montees de niveau, pour que la page charge en un appel. */
	config: XpConfigDto;
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
 * Annonce des montees de niveau.
 *
 * Le reglage vaut pour tout le serveur. Il n'a pas de `discordSyncedAt` : il ne
 * decrit rien a rejouer sur Discord, seulement la facon de rediger la prochaine
 * annonce — le bot le relit a chaque montee de niveau (avec un cache court).
 */
export interface XpConfigDto {
	guildId: Snowflake;
	mode: XpAnnouncementMode;
	/** Salon d'annonce, utilise par `DEDICATED_CHANNEL` seul. */
	channelId: Snowflake | null;
	/** Gabarit personnalise, ou `null` pour le texte par defaut du mode. */
	message: string | null;
	/** Mentionner le membre (donc le notifier) plutot que citer son nom. */
	pingMember: boolean;
	updatedAt: IsoDateString;
}

export interface UpdateXpConfigRequest {
	mode?: XpAnnouncementMode;
	channelId?: Snowflake | null;
	message?: string | null;
	pingMember?: boolean;
}

/**
 * Gabarit par defaut d'une annonce publique.
 *
 * Il reproduit mot pour mot le message envoye avant que ce reglage n'existe :
 * un serveur qui n'ouvre jamais la page ne doit voir aucun changement.
 */
export const DEFAULT_XP_LEVEL_UP_MESSAGE =
	"🎉 Bravo {membre}, tu passes **niveau {niveau}** !{recompenses}";

/** En message prive, le salon ne dit plus de quel serveur il s'agit. */
export const DEFAULT_XP_LEVEL_UP_DIRECT_MESSAGE =
	"🎉 Bravo, tu passes **niveau {niveau}** sur **{serveur}** !{recompenses}";

/** Un message plus long que cela serait de toute facon refuse par Discord. */
export const MAX_XP_LEVEL_UP_MESSAGE_LENGTH = 1000;

export function defaultXpLevelUpMessage(mode: XpAnnouncementMode): string {
	return mode === XpAnnouncementMode.DIRECT_MESSAGE
		? DEFAULT_XP_LEVEL_UP_DIRECT_MESSAGE
		: DEFAULT_XP_LEVEL_UP_MESSAGE;
}

/** Substitutions reconnues, listees telles quelles sous le champ du dashboard. */
export const XP_LEVEL_UP_PLACEHOLDERS = [
	{ token: "{membre}", label: "Le membre (mention ou nom, selon le réglage)" },
	{ token: "{niveau}", label: "Le niveau atteint" },
	{ token: "{serveur}", label: "Le nom du serveur" },
	{
		token: "{recompenses}",
		label: "Phrase annonçant les rôles débloqués, vide s'il n'y en a aucun",
	},
] as const;

export interface XpLevelUpMessageContext {
	/** Ce qui remplace `{membre}` : `<@id>` si la mention est active, un nom sinon. */
	member: string;
	level: number;
	guildName: string;
	/** Mentions des roles fraichement obtenus, dans l'ordre des paliers. */
	roleMentions: string[];
}

/**
 * Rend le gabarit d'annonce.
 *
 * Partage entre le bot (qui envoie) et le dashboard (qui previsualise) : deux
 * rendus separes finiraient par diverger, et l'apercu mentirait sur ce que
 * lira le serveur.
 *
 * `{recompenses}` porte la **phrase entiere**, pas la seule liste de roles.
 * C'est ce qui permet de la faire disparaitre proprement quand la montee de
 * niveau ne debloque rien : un gabarit du genre « Nouveau rôle : {roles} »
 * laisserait une etiquette orpheline la plupart du temps.
 */
export function renderXpLevelUpMessage(
	template: string,
	context: XpLevelUpMessageContext,
): string {
	const rewards = context.roleMentions.length
		? ` Tu débloques ${context.roleMentions.join(", ")} !`
		: "";

	return template
		.replaceAll("{membre}", context.member)
		.replaceAll("{niveau}", String(context.level))
		.replaceAll("{serveur}", context.guildName)
		.replaceAll("{recompenses}", rewards);
}

/**
 * Palier le plus haut accepte.
 *
 * Au-dela, `xpRequiredForLevel` depasse le milliard d'XP : un palier que
 * personne n'atteindra jamais n'est pas un reglage, c'est une faute de frappe.
 */
export const MAX_XP_REWARD_LEVEL = 500;
