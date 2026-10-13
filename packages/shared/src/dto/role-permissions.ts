import { AppUserRole } from "../enums";
import { Permission } from "../permissions";
import { IsoDateString } from "./common";

/**
 * Libelles des permissions, pour l'ecran de reglage.
 *
 * Ils decrivent ce que la permission autorise, pas la page ou elle s'applique :
 * une meme permission peut ouvrir plusieurs ecrans.
 */
export const PERMISSION_LABELS: Record<Permission, string> = {
	"members:read": "Consulter les membres et leurs fiches",
	"member-roles:write": "Ajouter des rôles séparateurs à un membre",
	"notes:read": "Lire les notes internes",
	"notes:write": "Écrire des notes internes",
	"notes:delete": "Supprimer des notes internes",
	"warnings:read": "Consulter les avertissements",
	"warnings:write": "Donner un avertissement",
	"warnings:revoke": "Lever un avertissement",
	"sanctions:read": "Consulter les sanctions",
	"sanctions:write": "Poser une sanction",
	"sanctions:revoke": "Lever une sanction",
	"moderation-points:configure": "Régler le barème de points de modération",
	"tickets:read": "Consulter les tickets",
	"tickets:write": "Répondre et agir sur les tickets",
	"stats:read": "Consulter les statistiques",
	"roles:manage": "Choisir les rôles suivis dans l'historique et les séparateurs",
	"users:read": "Consulter les comptes du dashboard",
	"users:write": "Créer et modifier les comptes du dashboard",
	"audit:read": "Consulter le journal d'activité",
	"logs:read": "Consulter la configuration du serveur",
	"logs:write": "Modifier la configuration du serveur",
	"automod:read": "Consulter l'automodération",
	"automod:write": "Régler les règles d'automodération",
	"raid:read": "Consulter l'anti-raid",
	"raid:respond": "Déclencher ou lever un confinement",
	"raid:configure": "Régler les seuils de l'anti-raid",
	"account-flags:read": "Consulter les comptes signalés",
	"account-flags:write": "Traiter les comptes signalés",
	"status:read": "Consulter la page de statut",
	"quarantine:read": "Consulter la quarantaine",
	"quarantine:respond": "Débloquer un membre en quarantaine",
	"quarantine:configure": "Régler la quarantaine",
	"battlenet:read": "Voir le BattleTag des membres vérifiés",
	"voice:read": "Consulter les vocaux en direct",
	"voice:manage": "Gérer les salons de création vocaux",
	"permissions:manage": "Modifier les permissions des rôles",
	"wiki:read": "Consulter le wiki de modération",
	"wiki:write": "Rédiger et modifier les articles du wiki",
	"wiki:delete": "Supprimer un article du wiki",
	"giveaway:read": "Consulter les concours",
	"giveaway:write": "Créer, modifier et annuler un concours",
	"embeds:read": "Consulter les messages composés",
	"embeds:write": "Composer et envoyer un message sur Discord",
	"xp:read": "Consulter le classement d'expérience",
	"xp:manage": "Régler les paliers de récompense",
	"esport:read": "Consulter les matchs esport",
	"esport:write": "Composer et envoyer les matchs esport, saisir les scores",
	"esport:manage": "Régler l'esport et retirer un message publié",
	"sessions:read": "Consulter les sessions ouvertes de l'équipe",
	"sessions:revoke": "Fermer la session d'un compte",
};

/** Regroupement d'affichage : une carte par domaine dans l'ecran de reglage. */
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
	{
		label: "Membres",
		permissions: [
			Permission.MEMBERS_READ,
			Permission.MEMBER_ROLES_WRITE,
			Permission.STATS_READ,
			Permission.NOTES_READ,
			Permission.NOTES_WRITE,
			Permission.NOTES_DELETE,
		],
	},
	{
		label: "Modération",
		permissions: [
			Permission.WARNINGS_READ,
			Permission.WARNINGS_WRITE,
			Permission.WARNINGS_REVOKE,
			Permission.SANCTIONS_READ,
			Permission.SANCTIONS_WRITE,
			Permission.SANCTIONS_REVOKE,
			Permission.MODERATION_POINTS_CONFIGURE,
			Permission.TICKETS_READ,
			Permission.TICKETS_WRITE,
		],
	},
	{
		label: "Sécurité",
		permissions: [
			Permission.AUTOMOD_READ,
			Permission.AUTOMOD_WRITE,
			Permission.RAID_READ,
			Permission.RAID_RESPOND,
			Permission.RAID_CONFIGURE,
			Permission.ACCOUNT_FLAGS_READ,
			Permission.ACCOUNT_FLAGS_WRITE,
			Permission.QUARANTINE_READ,
			Permission.QUARANTINE_RESPOND,
			Permission.QUARANTINE_CONFIGURE,
			Permission.BATTLENET_READ,
		],
	},
	{
		label: "Vocaux",
		permissions: [Permission.VOICE_READ, Permission.VOICE_MANAGE],
	},
	{
		label: "Wiki",
		permissions: [Permission.WIKI_READ, Permission.WIKI_WRITE, Permission.WIKI_DELETE],
	},
	{
		label: "Animation",
		permissions: [
			Permission.GIVEAWAY_READ,
			Permission.GIVEAWAY_WRITE,
			Permission.EMBEDS_READ,
			Permission.EMBEDS_WRITE,
			Permission.XP_READ,
			Permission.XP_MANAGE,
			Permission.ESPORT_READ,
			Permission.ESPORT_WRITE,
			Permission.ESPORT_MANAGE,
		],
	},
	{
		label: "Administration",
		permissions: [
			Permission.STATUS_READ,
			Permission.ROLES_MANAGE,
			Permission.LOGS_READ,
			Permission.LOGS_WRITE,
			Permission.USERS_READ,
			Permission.USERS_WRITE,
			Permission.AUDIT_READ,
			Permission.PERMISSIONS_MANAGE,
			Permission.SESSIONS_READ,
			Permission.SESSIONS_REVOKE,
		],
	},
];

export interface RolePermissionsDto {
	role: AppUserRole;
	/** Permissions reellement appliquees, defauts et ecarts combines. */
	permissions: Permission[];
	/** Matrice livree avec le code, pour signaler ce qui a ete modifie. */
	defaults: Permission[];
	/** Ni modifiable ni retirable : le role proprietaire garde tout. */
	locked: boolean;
	/** Nombre de permissions s'ecartant du defaut. */
	overrideCount: number;
}

export interface RolePermissionsMatrixDto {
	roles: RolePermissionsDto[];
	updatedAt: IsoDateString | null;
}

export interface UpdateRolePermissionsRequest {
	/** Liste complete voulue pour ce role ; l'API en deduit les ecarts. */
	permissions: Permission[];
}
