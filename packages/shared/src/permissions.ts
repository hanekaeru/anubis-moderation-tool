import { AppUserRole } from "./enums";

/**
 * Les droits sont exprimes en permissions fines, pas en roles. L'API et le
 * dashboard verifient une permission ; le role ne fait que la distribuer.
 * Ajouter une fonctionnalite = ajouter une permission ici, pas un `if` sur le
 * role dissemine dans le code.
 */
export const Permission = {
	MEMBERS_READ: "members:read",
	/**
	 * Ajouter des roles separateurs a un membre depuis sa fiche.
	 *
	 * Limitee aux roles marques separateurs : ils ne portent aucun droit, ils
	 * rangent le profil. Choisir lesquels le sont releve de `roles:manage`.
	 */
	MEMBER_ROLES_WRITE: "member-roles:write",
	NOTES_READ: "notes:read",
	NOTES_WRITE: "notes:write",
	NOTES_DELETE: "notes:delete",
	WARNINGS_READ: "warnings:read",
	WARNINGS_WRITE: "warnings:write",
	WARNINGS_REVOKE: "warnings:revoke",
	SANCTIONS_READ: "sanctions:read",
	SANCTIONS_WRITE: "sanctions:write",
	SANCTIONS_REVOKE: "sanctions:revoke",
	/**
	 * Regler le bareme de points. Sa lecture passe par `sanctions:read` : le
	 * formulaire de sanction en a besoin pour pre-remplir les points, y compris
	 * pour un moderateur qui n'a pas le droit de changer le bareme.
	 */
	MODERATION_POINTS_CONFIGURE: "moderation-points:configure",
	TICKETS_READ: "tickets:read",
	TICKETS_WRITE: "tickets:write",
	STATS_READ: "stats:read",
	ROLES_MANAGE: "roles:manage",
	USERS_READ: "users:read",
	USERS_WRITE: "users:write",
	AUDIT_READ: "audit:read",
	LOGS_READ: "logs:read",
	LOGS_WRITE: "logs:write",
	AUTOMOD_READ: "automod:read",
	AUTOMOD_WRITE: "automod:write",
	RAID_READ: "raid:read",
	RAID_RESPOND: "raid:respond",
	RAID_CONFIGURE: "raid:configure",
	ACCOUNT_FLAGS_READ: "account-flags:read",
	ACCOUNT_FLAGS_WRITE: "account-flags:write",
	STATUS_READ: "status:read",
	QUARANTINE_READ: "quarantine:read",
	QUARANTINE_RESPOND: "quarantine:respond",
	QUARANTINE_CONFIGURE: "quarantine:configure",
	/**
	 * Lire le BattleTag lie a un membre verifie.
	 *
	 * Separee de `QUARANTINE_READ` a dessein : savoir qu'un membre a passe la
	 * verification releve de la moderation courante, lire son identite Blizzard
	 * non. Le BattleTag est une donnee personnelle qui suit la personne bien
	 * au-dela du serveur.
	 */
	BATTLENET_READ: "battlenet:read",
	VOICE_READ: "voice:read",
	VOICE_MANAGE: "voice:manage",
	PERMISSIONS_MANAGE: "permissions:manage",
	WIKI_READ: "wiki:read",
	WIKI_WRITE: "wiki:write",
	WIKI_DELETE: "wiki:delete",
	GIVEAWAY_READ: "giveaway:read",
	GIVEAWAY_WRITE: "giveaway:write",
	EMBEDS_READ: "embeds:read",
	EMBEDS_WRITE: "embeds:write",
	XP_READ: "xp:read",
	XP_MANAGE: "xp:manage",
	ESPORT_READ: "esport:read",
	/** Composer les semaines, gerer les equipes, envoyer, saisir les scores. */
	ESPORT_WRITE: "esport:write",
	/**
	 * Regler les salons et le role interpelle, et **retirer un message publie**
	 * de Discord. Ce qui a ete lu par le serveur ne se reprend pas d'un clic de
	 * moderateur.
	 */
	ESPORT_MANAGE: "esport:manage",
	SESSIONS_READ: "sessions:read",
	SESSIONS_REVOKE: "sessions:revoke",
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const VIEWER_PERMISSIONS: Permission[] = [
	Permission.MEMBERS_READ,
	Permission.NOTES_READ,
	Permission.WARNINGS_READ,
	Permission.SANCTIONS_READ,
	Permission.TICKETS_READ,
	Permission.STATS_READ,
	Permission.AUTOMOD_READ,
	Permission.RAID_READ,
	Permission.ACCOUNT_FLAGS_READ,
	Permission.STATUS_READ,
	Permission.QUARANTINE_READ,
	Permission.VOICE_READ,
	// Le wiki dit ce qu'on attend de l'equipe : il n'a d'utilite que lu par
	// tous, y compris par un compte en observation.
	Permission.WIKI_READ,
	Permission.GIVEAWAY_READ,
	// Le classement d'experience ne dit rien de sensible : c'est la meme
	// information que `/rank` rend deja publique sur le serveur.
	Permission.XP_READ,
	Permission.ESPORT_READ,
];

const MODERATOR_PERMISSIONS: Permission[] = [
	...VIEWER_PERMISSIONS,
	// Un separateur n'ouvre aucun salon et ne donne aucun droit : le poser
	// releve du soin des profils, pas de la configuration du serveur.
	Permission.MEMBER_ROLES_WRITE,
	Permission.NOTES_WRITE,
	Permission.WARNINGS_WRITE,
	Permission.WARNINGS_REVOKE,
	Permission.SANCTIONS_WRITE,
	Permission.SANCTIONS_REVOKE,
	Permission.TICKETS_WRITE,
	Permission.LOGS_READ,
	// Reponse operationnelle rapide (lever/declencher un confinement, traiter
	// un signalement) : de la moderation courante, pas de la configuration.
	Permission.RAID_RESPOND,
	Permission.ACCOUNT_FLAGS_WRITE,
	Permission.QUARANTINE_RESPOND,
	// Animer le serveur fait partie du quotidien de l'equipe, pas de sa
	// configuration : un concours n'ouvre aucun droit sur les membres.
	Permission.GIVEAWAY_WRITE,
	// Meme raison que les concours : tenir le calendrier des matchs fait partie
	// de l'animation, pas de la configuration.
	Permission.ESPORT_WRITE,
	// Lire les messages composes par l'equipe : savoir ce qui a ete annonce
	// fait partie du contexte d'une moderation.
	Permission.EMBEDS_READ,
];

const ADMIN_PERMISSIONS: Permission[] = [
	...MODERATOR_PERMISSIONS,
	Permission.NOTES_DELETE,
	// Regler ce qui est historise releve de la configuration du serveur, pas de
	// la moderation courante : un moderateur ne doit pas pouvoir faire
	// disparaitre une categorie entiere d'evenements de la chronologie.
	Permission.ROLES_MANAGE,
	Permission.USERS_READ,
	Permission.USERS_WRITE,
	Permission.AUDIT_READ,
	Permission.LOGS_WRITE,
	// Reglages structurants (seuils, regles, actions automatiques) : meme
	// niveau que LOGS_WRITE, pas la reponse au quotidien.
	Permission.AUTOMOD_WRITE,
	Permission.RAID_CONFIGURE,
	Permission.QUARANTINE_CONFIGURE,
	// Le BattleTag identifie la personne hors du serveur : le lire n'aide pas a
	// moderer, il aide a la retrouver ailleurs. Un moderateur voit deja qu'un
	// membre est verifie, ce qui suffit a son travail.
	Permission.BATTLENET_READ,
	// Le bareme de points decide de ce qui fait passer un membre pour
	// problematique : le deplacer requalifie tout le serveur d'un seul reglage.
	// C'est de la doctrine, pas de la moderation courante.
	Permission.MODERATION_POINTS_CONFIGURE,
	// Les salons de creation dictent ce que le bot cree tout seul sur le
	// serveur : le meme niveau que les autres reglages structurants.
	Permission.VOICE_MANAGE,
	// Le wiki fait doctrine : ce qui y est ecrit est ce qu'on reprochera a un
	// moderateur de ne pas avoir suivi. L'ecriture reste donc au-dessus de la
	// moderation courante — un serveur qui prefere l'ouvrir a son equipe le
	// fait par la page Permissions, sans toucher au code.
	Permission.WIKI_WRITE,
	Permission.WIKI_DELETE,
	// Publier un message signe du bot, c'est parler au nom du serveur : la
	// portee est celle d'une annonce, pas celle d'une sanction individuelle.
	Permission.EMBEDS_WRITE,
	// Les paliers de recompense modifient les roles de tout le serveur des que
	// le bot repasse : un reglage structurant, au meme titre que l'automod.
	Permission.XP_MANAGE,
	Permission.ESPORT_MANAGE,
];

/**
 * Permissions **volontairement absentes** de la matrice ci-dessus : elles ne
 * sont portees que par le proprietaire, qui recoit `Object.values(Permission)`.
 *
 * Voir et couper les sessions ouvertes revient a lire les traces de connexion
 * de toute l'equipe (adresses IP, navigateurs) et a deconnecter n'importe qui,
 * y compris un compte de rang superieur. C'est le meme raisonnement que pour
 * `PERMISSIONS_MANAGE` : un droit qui permet de reprendre la main sur les
 * autres ne se delegue pas par defaut.
 *
 * Un serveur qui souhaite l'ouvrir a un administrateur le fait depuis la page
 * Permissions, sans toucher au code — et cette liste dit alors ce qu'il
 * accorde.
 */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = [
	Permission.PERMISSIONS_MANAGE,
	Permission.SESSIONS_READ,
	Permission.SESSIONS_REVOKE,
];

export const ROLE_PERMISSIONS: Record<AppUserRole, readonly Permission[]> = {
	VIEWER: VIEWER_PERMISSIONS,
	MODERATOR: MODERATOR_PERMISSIONS,
	ADMIN: ADMIN_PERMISSIONS,
	OWNER: Object.values(Permission),
};

export function permissionsForRole(role: AppUserRole): readonly Permission[] {
	return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(
	role: AppUserRole,
	permission: Permission,
): boolean {
	return permissionsForRole(role).includes(permission);
}

/**
 * Le role proprietaire n'est jamais modifiable.
 *
 * C'est le garde-fou qui empeche de fermer la porte de l'interieur : sans lui,
 * retirer `permissions:manage` a tout le monde rendrait la matrice
 * definitivement inaccessible depuis le dashboard.
 */
export const IMMUTABLE_ROLE: AppUserRole = "OWNER";

/** Ecart enregistre en base par rapport a la matrice par defaut. */
export interface RolePermissionOverride {
	role: AppUserRole;
	permission: Permission;
	granted: boolean;
}

/**
 * Permissions effectives d'un role : `defauts ∪ accordees − retirees`.
 *
 * Partage entre l'API (qui l'applique) et le dashboard (qui la previsualise),
 * pour que les deux ne puissent pas diverger.
 */
export function resolveRolePermissions(
	role: AppUserRole,
	overrides: readonly RolePermissionOverride[],
): Permission[] {
	if (role === IMMUTABLE_ROLE) return [...permissionsForRole(role)];

	const effectives = new Set<Permission>(permissionsForRole(role));

	for (const override of overrides) {
		if (override.role !== role) continue;
		if (override.granted) effectives.add(override.permission);
		else effectives.delete(override.permission);
	}

	// L'ordre de `Permission` fait foi : il rend les listes comparables d'un
	// role a l'autre et stable d'un appel a l'autre.
	return Object.values(Permission).filter((permission) =>
		effectives.has(permission),
	);
}

/** Ordre hierarchique : un compte ne peut pas agir sur un rang superieur. */
export const ROLE_RANK: Record<AppUserRole, number> = {
	VIEWER: 0,
	MODERATOR: 1,
	ADMIN: 2,
	OWNER: 3,
};
