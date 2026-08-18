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
	// Concerne le Timeout classique proposé par Discord.
	TIMEOUT: "TIMEOUT",
	// Déconnecte l'utilisateur du serveur.
	KICK: "KICK",
	// Banni l'utilisateur du serveur sans possibilité pour lui de rejoindre.
	BAN: "BAN",
	// Ajoute un rôle qui bloque complètement l'accès aux fonctionnalités du serveur.
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
	TRANSCRIPT_ARCHIVED: "TRANSCRIPT_ARCHIVED",
} as const;
export type TicketEventType =
	(typeof TicketEventType)[keyof typeof TicketEventType];

export const TicketCategory = {
	SUPPORT: "SUPPORT",
	REPORT: "REPORT",
	COMPLAINT: "COMPLAINT",
	PARTNERSHIP: "PARTNERSHIP",
	OTHER: "OTHER",
} as const;
export type TicketCategory =
	(typeof TicketCategory)[keyof typeof TicketCategory];

export const AppUserRole = {
	VIEWER: "VIEWER",
	MODERATOR: "MODERATOR",
	ADMIN: "ADMIN",
	OWNER: "OWNER",
} as const;
export type AppUserRole = (typeof AppUserRole)[keyof typeof AppUserRole];

export const AutomodRuleType = {
	SPAM_RATE: "SPAM_RATE",
	ATTACHMENT_SPAM: "ATTACHMENT_SPAM",
	MASS_MENTIONS: "MASS_MENTIONS",
	LINKS_INVITES: "LINKS_INVITES",
	WORD_FILTER: "WORD_FILTER",
	EXCESSIVE_CAPS: "EXCESSIVE_CAPS",
	REPETITION: "REPETITION",
} as const;
export type AutomodRuleType =
	(typeof AutomodRuleType)[keyof typeof AutomodRuleType];

export const AutomodAction = {
	LOG_ONLY: "LOG_ONLY",
	DELETE: "DELETE",
	DELETE_AND_TIMEOUT: "DELETE_AND_TIMEOUT",
} as const;
export type AutomodAction = (typeof AutomodAction)[keyof typeof AutomodAction];

export const WikiCategory = {
	SANCTIONS: "SANCTIONS",
	BEHAVIOR: "BEHAVIOR",
	PROCEDURES: "PROCEDURES",
	TOOLS: "TOOLS",
	ONBOARDING: "ONBOARDING",
	OTHER: "OTHER",
} as const;
export type WikiCategory = (typeof WikiCategory)[keyof typeof WikiCategory];

export const AccountFlagType = {
	NEW_ACCOUNT: "NEW_ACCOUNT",
	DEFAULT_AVATAR: "DEFAULT_AVATAR",
	STAFF_IMPERSONATION: "STAFF_IMPERSONATION",
	QUICK_REJOIN: "QUICK_REJOIN",
	JOINED_AFTER_BAN: "JOINED_AFTER_BAN",
} as const;
export type AccountFlagType =
	(typeof AccountFlagType)[keyof typeof AccountFlagType];

export const GiveawayStatus = {
	SCHEDULED: "SCHEDULED",
	RUNNING: "RUNNING",
	ENDED: "ENDED",
	CANCELLED: "CANCELLED",
} as const;
export type GiveawayStatus =
	(typeof GiveawayStatus)[keyof typeof GiveawayStatus];

export const EmbedMessageStatus = {
	DRAFT: "DRAFT",
	QUEUED: "QUEUED",
	SENT: "SENT",
	FAILED: "FAILED",
} as const;
export type EmbedMessageStatus =
	(typeof EmbedMessageStatus)[keyof typeof EmbedMessageStatus];

export const XpAnnouncementMode = {
	CURRENT_CHANNEL: "CURRENT_CHANNEL",
	DEDICATED_CHANNEL: "DEDICATED_CHANNEL",
	DIRECT_MESSAGE: "DIRECT_MESSAGE",
	DISABLED: "DISABLED",
} as const;
export type XpAnnouncementMode =
	(typeof XpAnnouncementMode)[keyof typeof XpAnnouncementMode];

/** Libelles francais, pour ne pas les repeter dans chaque composant. */
export const SANCTION_TYPE_LABELS: Record<SanctionType, string> = {
	TIMEOUT: "Exclusion temporaire",
	KICK: "Expulsion",
	BAN: "Bannissement",
	SHADOWBAN: "Shadowban",
};

export const SANCTION_STATUS_LABELS: Record<SanctionStatus, string> = {
	ACTIVE: "En cours",
	EXPIRED: "Terminée",
	REVOKED: "Levée",
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

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
	SUPPORT: "Support technique",
	REPORT: "Signalement d'un membre",
	COMPLAINT: "Réclamation / Litige",
	PARTNERSHIP: "Partenariat",
	OTHER: "Autre",
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

export const AUTOMOD_RULE_TYPE_LABELS: Record<AutomodRuleType, string> = {
	SPAM_RATE: "Débit de messages",
	ATTACHMENT_SPAM: "Envoi répété d'images",
	MASS_MENTIONS: "Mentions massives",
	LINKS_INVITES: "Liens et invitations",
	WORD_FILTER: "Filtre de mots",
	EXCESSIVE_CAPS: "Majuscules excessives",
	REPETITION: "Répétition",
};

export const AUTOMOD_RULE_TYPE_DESCRIPTIONS: Record<AutomodRuleType, string> = {
	SPAM_RATE: "Trop de messages en peu de temps de la part d'un même membre.",
	ATTACHMENT_SPAM:
		"Trop d'images ou de pièces jointes en peu de temps de la part d'un même membre.",
	MASS_MENTIONS: "Trop de mentions (membres ou rôles) dans un seul message.",
	LINKS_INVITES: "Liens ou invitations Discord non autorisés.",
	WORD_FILTER: "Mots ou expressions interdits sur le serveur.",
	EXCESSIVE_CAPS: "Message majoritairement en majuscules.",
	REPETITION: "Caractères ou messages répétés à l'excès.",
};

export const AUTOMOD_ACTION_LABELS: Record<AutomodAction, string> = {
	LOG_ONLY: "Journaliser uniquement",
	DELETE: "Supprimer le message",
	DELETE_AND_TIMEOUT: "Supprimer et exclure temporairement",
};

export const ACCOUNT_FLAG_TYPE_LABELS: Record<AccountFlagType, string> = {
	NEW_ACCOUNT: "Compte récent (< 2 jours)",
	DEFAULT_AVATAR: "Avatar par défaut",
	STAFF_IMPERSONATION: "Pseudo imitant un membre du staff",
	QUICK_REJOIN: "Retour rapide après un départ",
	JOINED_AFTER_BAN: "Arrivée juste après un bannissement",
};

export const GIVEAWAY_STATUS_LABELS: Record<GiveawayStatus, string> = {
	SCHEDULED: "Programmé",
	RUNNING: "En cours",
	ENDED: "Terminé",
	CANCELLED: "Annulé",
};

export const EMBED_MESSAGE_STATUS_LABELS: Record<EmbedMessageStatus, string> = {
	DRAFT: "Brouillon",
	QUEUED: "En attente d'envoi",
	SENT: "Envoyé",
	FAILED: "Échec",
};

export const XP_ANNOUNCEMENT_MODE_LABELS: Record<XpAnnouncementMode, string> = {
	CURRENT_CHANNEL: "Dans le salon où le niveau est atteint",
	DEDICATED_CHANNEL: "Dans un salon dédié",
	DIRECT_MESSAGE: "En message privé",
	DISABLED: "Aucune annonce",
};

export const XP_ANNOUNCEMENT_MODE_DESCRIPTIONS: Record<
	XpAnnouncementMode,
	string
> = {
	CURRENT_CHANNEL:
		"Le membre est félicité là où il écrivait : il lit déjà le salon, l'annonce ne le déplace pas.",
	DEDICATED_CHANNEL:
		"Toutes les montées de niveau sont regroupées dans un même salon, sans déranger les conversations.",
	DIRECT_MESSAGE:
		"Personne d'autre que l'intéressé ne voit l'annonce. Un membre qui a fermé ses messages privés ne reçoit rien.",
	DISABLED:
		"Aucun message n'est envoyé. Les rôles de palier continuent d'être attribués.",
};

export const WIKI_CATEGORY_LABELS: Record<WikiCategory, string> = {
	SANCTIONS: "Sanctions",
	BEHAVIOR: "Comportement",
	PROCEDURES: "Procédures",
	TOOLS: "Outils",
	ONBOARDING: "Prise de poste",
	OTHER: "Divers",
};

/**
 * Ordre d'affichage des categories du wiki.
 *
 * L'ordre de declaration de l'enum ne fait pas foi cote base : c'est celui-ci
 * qui range les sections de la page, du plus consulte au plus annexe.
 */
export const WIKI_CATEGORY_ORDER: WikiCategory[] = [
	WikiCategory.SANCTIONS,
	WikiCategory.BEHAVIOR,
	WikiCategory.PROCEDURES,
	WikiCategory.TOOLS,
	WikiCategory.ONBOARDING,
	WikiCategory.OTHER,
];

/** Icone Material par categorie, partagee par la liste et la fiche. */
export const WIKI_CATEGORY_ICONS: Record<WikiCategory, string> = {
	SANCTIONS: "gavel",
	BEHAVIOR: "diversity_3",
	PROCEDURES: "checklist",
	TOOLS: "build",
	ONBOARDING: "school",
	OTHER: "article",
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
	VOICE: "LOG_CHANNEL_VOICE",
} as const;
export type LogChannelKey = (typeof LogChannelKey)[keyof typeof LogChannelKey];

export const LOG_CHANNEL_LABELS: Record<LogChannelKey, string> = {
	LOG_CHANNEL_MODERATION: "Journal de modération",
	LOG_CHANNEL_MEMBERS: "Journal des membres",
	LOG_CHANNEL_MESSAGES: "Journal des messages",
	LOG_CHANNEL_SERVER: "Journal du serveur",
	LOG_CHANNEL_VOICE: "Journal des vocaux",
};

export const LOG_CHANNEL_DESCRIPTIONS: Record<LogChannelKey, string> = {
	LOG_CHANNEL_MODERATION:
		"Avertissements, sanctions et actions de modération.",
	LOG_CHANNEL_MEMBERS: "Arrivées et départs de membres.",
	LOG_CHANNEL_MESSAGES: "Messages édités ou supprimés.",
	LOG_CHANNEL_SERVER: "Salons et rôles créés, modifiés ou supprimés.",
	LOG_CHANNEL_VOICE:
		"Salons vocaux temporaires : créations, arrivées, départs, propriété et signalements.",
};

/**
 * Cle `config_name` sous laquelle le bot enregistre l'identifiant du role de
 * shadowban, cree paresseusement au premier `/shadowban` sur un serveur.
 */
export const SHADOWBAN_ROLE_CONFIG_KEY = "SHADOWBAN_ROLE";

/**
 * Cle `config_name` sous laquelle le bot enregistre l'identifiant du salon
 * d'archive des transcripts de tickets, cree paresseusement au premier usage
 * de `/create_ticket_panel`.
 */
export const TICKET_TRANSCRIPT_CHANNEL_CONFIG_KEY = "TICKET_TRANSCRIPT_CHANNEL";
