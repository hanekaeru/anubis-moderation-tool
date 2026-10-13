/**
 * Roles declares par le serveur, et facon dont le bot mentionne les gens.
 *
 * Tout vit dans `config_guild`, comme les salons de logs : une cle
 * d'application dans une table clef/valeur, pas un enum Postgres. C'est ce qui
 * evite une migration a chaque role que le serveur voudra nommer.
 *
 * Le rendu d'une reference de membre est ici plutot que dans le bot parce que
 * le dashboard previsualise le reglage — meme raison que
 * `renderXpLevelUpMessage` : un apercu qui ne passe pas par la meme fonction
 * finit par mentir.
 */

/**
 * Cles `config_name` portant un identifiant de role.
 *
 * Le role est declare une fois ici et reference ailleurs (aujourd'hui par la
 * mention posee a l'ouverture d'un ticket) : changer le role de moderation se
 * fait alors a un seul endroit, sans revisiter chaque reglage qui s'en sert.
 */
export const GuildRoleKey = {
	MODERATION: "MOD_ROLE",
	ADMIN: "ADMIN_ROLE",
	STAFF: "STAFF_ROLE",
	SUPPORT: "SUPPORT_ROLE",
} as const;
export type GuildRoleKey = (typeof GuildRoleKey)[keyof typeof GuildRoleKey];

export const GUILD_ROLE_LABELS: Record<GuildRoleKey, string> = {
	MOD_ROLE: "Modération",
	ADMIN_ROLE: "Administration",
	STAFF_ROLE: "Staff",
	SUPPORT_ROLE: "Support",
};

export const GUILD_ROLE_DESCRIPTIONS: Record<GuildRoleKey, string> = {
	MOD_ROLE: "Rôle de l'équipe de modération.",
	ADMIN_ROLE: "Rôle des administrateurs du serveur.",
	STAFF_ROLE: "Rôle couvrant l'ensemble de l'équipe.",
	SUPPORT_ROLE: "Rôle chargé de l'assistance aux membres.",
};

/** Cles `config_name` des reglages de mention. */
export const MentionSettingKey = {
	/**
	 * Cle de role interpelle quand le staff doit venir, vide pour aucune.
	 *
	 * Un seul reglage pour tous les usages — ouverture d'un ticket, signalement
	 * dans un salon vocal, nouveau boost (`{moderation}`) — parce que c'est la
	 * meme equipe qu'on appelle. En separer plusieurs inviterait a n'en
	 * configurer qu'un.
	 */
	ALERT_ROLE: "ALERT_MENTION_ROLE",
	/** `"true"` pour mentionner les membres dans les journaux. */
	LOG_MEMBERS: "LOG_MENTION_MEMBERS",
} as const;

/**
 * Les journaux n'interpellent personne par defaut.
 *
 * C'est le seul reglage de ce depot dont le defaut ne reproduit pas le
 * comportement anterieur, et c'est volontaire : une mention dans un journal
 * surligne le nom d'un moderateur a chaque arrivee en vocal sans rien lui
 * demander. L'identifiant reste ecrit dans les deux cas, donc rien ne se perd.
 */
export const DEFAULT_MENTION_MEMBERS = false;

/**
 * Reference d'un membre telle qu'elle s'ecrit dans un journal.
 *
 * L'identifiant y figure toujours : c'est lui qui permet de retrouver un compte
 * renomme, et il survit au depart du membre, ce que la mention ne fait pas.
 */
export function renderMemberReference(
	userId: string,
	username: string | null,
	mention: boolean,
): string {
	if (mention) return `<@${userId}> | \`${userId}\``;
	return `\`${username ?? "inconnu"}\` | \`${userId}\``;
}
