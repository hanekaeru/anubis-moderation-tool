import { AppUserRole } from "../enums";
import { IsoDateString, PaginationQuery, Snowflake } from "./common";

export interface AppUserDto {
	id: string;
	username: string;
	displayName: string;
	role: AppUserRole;
	isActive: boolean;
	mustChangePassword: boolean;
	discordUserId: Snowflake | null;
	lastLoginAt: IsoDateString | null;
	lockedUntil: IsoDateString | null;
	/** Double authentification active : lisible, jamais modifiable a distance. */
	twoFactorEnabled: boolean;
	createdAt: IsoDateString;
	createdByLabel: string | null;
}

export interface CreateAppUserRequest {
	username: string;
	displayName: string;
	role: AppUserRole;
	/**
	 * Mot de passe initial. Omis, l'API en genere un et le renvoie une seule
	 * fois dans `generatedPassword` : c'est le mode a privilegier.
	 */
	password?: string;
	discordUserId?: Snowflake | null;
}

export interface CreateAppUserResponse {
	user: AppUserDto;
	/** Renvoye une seule fois, a la creation. Jamais relisible ensuite. */
	generatedPassword: string | null;
}

export interface UpdateAppUserRequest {
	displayName?: string;
	role?: AppUserRole;
	isActive?: boolean;
	discordUserId?: Snowflake | null;
}

export interface ResetPasswordResponse {
	generatedPassword: string;
}

export interface AppUserSearchQuery extends PaginationQuery {
	search?: string;
	role?: AppUserRole;
	isActive?: boolean;
}

export interface AuditLogEntryDto {
	id: string;
	actorLabel: string | null;
	action: string;
	entityType: string | null;
	entityId: string | null;
	ip: string | null;
	createdAt: IsoDateString;
}

export interface AuditLogQuery extends PaginationQuery {
	appUserId?: string;
	action?: string;
	from?: IsoDateString;
	to?: IsoDateString;
}

/**
 * Libelles des actions journalisees.
 *
 * Le journal stocke un verbe technique (`sanction.revoke`) pour rester
 * filtrable et stable ; l'affichage a besoin d'une phrase. Toute nouvelle
 * action passee a `AuditService.record` doit etre ajoutee ici, sinon le verbe
 * brut s'affiche tel quel — degradation acceptable, mais peu lisible.
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
	"auth.login": "Connexion",
	"auth.logout": "Déconnexion",
	"auth.password_changed": "Mot de passe changé",
	"auth.two_factor_enabled": "Double authentification activée",
	"auth.two_factor_disabled": "Double authentification désactivée",
	"auth.two_factor_recovery_codes_regenerated": "Codes de secours régénérés",
	"auth.two_factor_reset": "Double authentification réinitialisée",
	"session.revoke": "Session révoquée",
	"session.revoke_all": "Sessions d'un compte révoquées",
	"embed.create": "Message composé",
	"embed.update": "Message modifié",
	"embed.send": "Message envoyé sur Discord",
	"embed.delete": "Message supprimé",
	"xp.reward.create": "Palier de récompense ajouté",
	"xp.reward.update": "Palier de récompense modifié",
	"xp.reward.delete": "Palier de récompense supprimé",
	"warning.create": "Avertissement émis",
	"warning.revoke": "Avertissement levé",
	"sanction.create": "Sanction appliquée",
	"sanction.revoke": "Sanction levée",
	"note.create": "Note ajoutée",
	"note.update": "Note modifiée",
	"note.delete": "Note supprimée",
	"ticket.update": "Ticket mis à jour",
	"ticket.close": "Ticket fermé",
	"ticket.note": "Note interne sur un ticket",
	"appuser.create": "Compte staff créé",
	"appuser.update": "Compte staff modifié",
	"appuser.reset_password": "Mot de passe réinitialisé",
	"appuser.unlock": "Compte staff déverrouillé",
	"role.tracking": "Suivi de rôle modifié",
	"guildconfig.create": "Configuration ajoutée",
	"guildconfig.update": "Configuration modifiée",
	"guildconfig.delete": "Configuration supprimée",
};

/** Familles d'actions, pour le filtre de l'ecran de journal. */
export const AUDIT_ACTION_GROUPS: ReadonlyArray<{
	label: string;
	prefix: string;
}> = [
	{ label: "Authentification", prefix: "auth." },
	{ label: "Avertissements", prefix: "warning." },
	{ label: "Sanctions", prefix: "sanction." },
	{ label: "Notes", prefix: "note." },
	{ label: "Tickets", prefix: "ticket." },
	{ label: "Comptes du staff", prefix: "appuser." },
	{ label: "Sessions", prefix: "session." },
	{ label: "Messages composés", prefix: "embed." },
	{ label: "Expérience", prefix: "xp." },
	{ label: "Configuration", prefix: "guildconfig." },
];
