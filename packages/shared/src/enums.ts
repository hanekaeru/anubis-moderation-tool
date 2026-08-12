/**
 * Miroir TypeScript des enums de prisma/schema.prisma.
 *
 * Le navigateur ne peut pas importer le client Prisma (code serveur), donc les
 * valeurs sont redeclarees ici sous une forme utilisable partout. Toute
 * modification doit etre reportee dans les deux fichiers.
 */

export const MemberStatus = {
	ACTIVE: "ACTIVE",
	LEFT: "LEFT",
	BANNED: "BANNED",
} as const;
export type MemberStatus = (typeof MemberStatus)[keyof typeof MemberStatus];

export const IdentityEventType = {
	USERNAME_CHANGED: "USERNAME_CHANGED",
	GLOBAL_NAME_CHANGED: "GLOBAL_NAME_CHANGED",
	NICKNAME_CHANGED: "NICKNAME_CHANGED",
	AVATAR_CHANGED: "AVATAR_CHANGED",
} as const;
export type IdentityEventType =
	(typeof IdentityEventType)[keyof typeof IdentityEventType];

export const RoleEventType = {
	ADDED: "ADDED",
	REMOVED: "REMOVED",
} as const;
export type RoleEventType = (typeof RoleEventType)[keyof typeof RoleEventType];

export const WarningSeverity = {
	LOW: "LOW",
	MEDIUM: "MEDIUM",
	HIGH: "HIGH",
} as const;
export type WarningSeverity =
	(typeof WarningSeverity)[keyof typeof WarningSeverity];

export const SanctionType = {
	TIMEOUT: "TIMEOUT",
	VOICE_MUTE: "VOICE_MUTE",
	KICK: "KICK",
	SOFTBAN: "SOFTBAN",
	BAN: "BAN",
	SHADOWBAN: "SHADOWBAN",
} as const;
export type SanctionType = (typeof SanctionType)[keyof typeof SanctionType];

export const SanctionStatus = {
	ACTIVE: "ACTIVE",
	EXPIRED: "EXPIRED",
	REVOKED: "REVOKED",
} as const;
export type SanctionStatus =
	(typeof SanctionStatus)[keyof typeof SanctionStatus];

export const TicketStatus = {
	OPEN: "OPEN",
	PENDING: "PENDING",
	RESOLVED: "RESOLVED",
	CLOSED: "CLOSED",
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TicketPriority = {
	LOW: "LOW",
	NORMAL: "NORMAL",
	HIGH: "HIGH",
	URGENT: "URGENT",
} as const;
export type TicketPriority =
	(typeof TicketPriority)[keyof typeof TicketPriority];

export const TicketEventType = {
	OPENED: "OPENED",
	CLAIMED: "CLAIMED",
	ASSIGNED: "ASSIGNED",
	MESSAGE: "MESSAGE",
	STATUS_CHANGED: "STATUS_CHANGED",
	PRIORITY_CHANGED: "PRIORITY_CHANGED",
	INTERNAL_NOTE: "INTERNAL_NOTE",
	CLOSED: "CLOSED",
	REOPENED: "REOPENED",
} as const;
export type TicketEventType =
	(typeof TicketEventType)[keyof typeof TicketEventType];

export const AppUserRole = {
	VIEWER: "VIEWER",
	MODERATOR: "MODERATOR",
	ADMIN: "ADMIN",
	OWNER: "OWNER",
} as const;
export type AppUserRole = (typeof AppUserRole)[keyof typeof AppUserRole];

/** Libelles francais, pour ne pas les repeter dans chaque composant. */
export const SANCTION_TYPE_LABELS: Record<SanctionType, string> = {
	TIMEOUT: "Exclusion temporaire",
	VOICE_MUTE: "Mute vocal",
	KICK: "Expulsion",
	SOFTBAN: "Softban",
	BAN: "Bannissement",
	SHADOWBAN: "Shadowban",
};

export const SANCTION_STATUS_LABELS: Record<SanctionStatus, string> = {
	ACTIVE: "En cours",
	EXPIRED: "Terminee",
	REVOKED: "Levee",
};

export const WARNING_SEVERITY_LABELS: Record<WarningSeverity, string> = {
	LOW: "Légère",
	MEDIUM: "Moyenne",
	HIGH: "Grave",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
	OPEN: "Ouvert",
	PENDING: "En attente",
	RESOLVED: "Résolu",
	CLOSED: "Fermé",
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
	LOW: "Basse",
	NORMAL: "Normale",
	HIGH: "Haute",
	URGENT: "Urgente",
};

export const APP_USER_ROLE_LABELS: Record<AppUserRole, string> = {
	VIEWER: "Lecture seule",
	MODERATOR: "Modérateur",
	ADMIN: "Administrateur",
	OWNER: "Propriétaire",
};

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
	ACTIVE: "Présent(e)",
	LEFT: "Parti(e)",
	BANNED: "Banni(e)",
};

/**
 * Cles `config_name` reservees pour les salons de logs, ecrites par
 * `/create_logs` (bot) et affichees par la page Logs (dashboard).
 *
 * Convention d'application, pas un enum Postgres : `config_guild.config_name`
 * reste un `varchar` libre pour laisser la table accueillir d'autres reglages
 * plus tard.
 */
export const LogChannelKey = {
	MODERATION: "LOG_CHANNEL_MODERATION",
	MEMBERS: "LOG_CHANNEL_MEMBERS",
	MESSAGES: "LOG_CHANNEL_MESSAGES",
	SERVER: "LOG_CHANNEL_SERVER",
} as const;
export type LogChannelKey = (typeof LogChannelKey)[keyof typeof LogChannelKey];

export const LOG_CHANNEL_LABELS: Record<LogChannelKey, string> = {
	LOG_CHANNEL_MODERATION: "Journal de modération",
	LOG_CHANNEL_MEMBERS: "Journal des membres",
	LOG_CHANNEL_MESSAGES: "Journal des messages",
	LOG_CHANNEL_SERVER: "Journal du serveur",
};

export const LOG_CHANNEL_DESCRIPTIONS: Record<LogChannelKey, string> = {
	LOG_CHANNEL_MODERATION:
		"Avertissements, sanctions et actions de modération.",
	LOG_CHANNEL_MEMBERS: "Arrivées et départs de membres.",
	LOG_CHANNEL_MESSAGES: "Messages édités ou supprimés.",
	LOG_CHANNEL_SERVER: "Salons et roles crées, modifiés ou supprimés.",
};

/**
 * Cle `config_name` sous laquelle le bot enregistre l'identifiant du role de
 * shadowban, cree paresseusement au premier `/shadowban` sur un serveur.
 */
export const SHADOWBAN_ROLE_CONFIG_KEY = "SHADOWBAN_ROLE";
