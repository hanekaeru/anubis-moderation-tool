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
	"auth.logout": "Deconnexion",
	"auth.password_changed": "Mot de passe change",
	"warning.create": "Avertissement emis",
	"warning.revoke": "Avertissement leve",
	"sanction.create": "Sanction appliquee",
	"sanction.revoke": "Sanction levee",
	"note.create": "Note ajoutee",
	"note.update": "Note modifiee",
	"note.delete": "Note supprimee",
	"ticket.update": "Ticket mis a jour",
	"ticket.close": "Ticket ferme",
	"ticket.note": "Note interne sur un ticket",
	"appuser.create": "Compte staff cree",
	"appuser.update": "Compte staff modifie",
	"appuser.reset_password": "Mot de passe reinitialise",
	"appuser.unlock": "Compte staff deverrouille",
	"role.tracking": "Suivi de role modifie",
	"guildconfig.create": "Configuration ajoutee",
	"guildconfig.update": "Configuration modifiee",
	"guildconfig.delete": "Configuration supprimee",
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
	{ label: "Configuration", prefix: "guildconfig." },
];
