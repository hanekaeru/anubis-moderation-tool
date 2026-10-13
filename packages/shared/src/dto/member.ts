import { MemberStatus } from "../enums";
import { IsoDateString, PaginationQuery, Snowflake } from "./common";
import { ModerationScoreDto } from "./moderation";

export interface RoleSummary {
	id: Snowflake;
	name: string;
	/** Couleur Discord en entier ; 0 signifie "pas de couleur". */
	color: number;
	position: number;
	managed: boolean;
	/**
	 * Les attributions et retraits de ce role sont-ils historises ?
	 *
	 * A `false` pour les roles decoratifs : le role continue d'apparaitre sur la
	 * fiche du membre et de servir de filtre, mais ses mouvements ne polluent
	 * plus la chronologie.
	 */
	trackHistory: boolean;
	/**
	 * Role separateur (« ━━ Jeux ━━ ») : purement decoratif, il range les roles
	 * en sections dans le profil Discord. Les separateurs sont les seuls roles
	 * que la fiche membre permet d'ajouter.
	 */
	separator: boolean;
}

/** Reglages d'un role ; un champ absent n'est pas modifie. */
export interface UpdateRoleSettingsRequest {
	trackHistory?: boolean;
	separator?: boolean;
}

/**
 * Ajout de roles separateurs a un membre.
 *
 * L'API depose la demande, le bot l'applique au passage suivant de sa
 * synchronisation (cinq secondes au plus) : elle n'a aucun acces a Discord.
 */
export interface AddMemberSeparatorsRequest {
	roleIds: Snowflake[];
}

export interface MemberRoleRequestDto {
	id: string;
	/** Roles reellement demandes : ceux que le membre portait deja sont ecartes. */
	roleIds: Snowflake[];
	createdAt: IsoDateString;
}

/** Ligne de la liste des membres : volontairement legere. */
export interface MemberListItem {
	userId: Snowflake;
	username: string;
	globalName: string | null;
	nickname: string | null;
	avatarUrl: string | null;
	status: MemberStatus;
	joinedAt: IsoDateString | null;
	roles: RoleSummary[];
	warningCount: number;
	activeSanctionCount: number;
	messageCount30d: number;
	lastActiveAt: IsoDateString | null;
}

/** Fiche complete d'un membre. */
export interface MemberDetail {
	userId: Snowflake;
	guildId: Snowflake;
	username: string;
	globalName: string | null;
	nickname: string | null;
	avatarUrl: string | null;
	isBot: boolean;
	status: MemberStatus;
	accountCreatedAt: IsoDateString | null;
	joinedAt: IsoDateString | null;
	leftAt: IsoDateString | null;
	joinCount: number;
	boostingSince: IsoDateString | null;
	roles: RoleSummary[];
	xp: number;
	counters: MemberCounters;
	/** Poids cumule de ce qui est encore actif contre ce membre. */
	moderationScore: ModerationScoreDto;
}

export interface MemberCounters {
	warnings: number;
	activeWarnings: number;
	sanctions: number;
	activeSanctions: number;
	notes: number;
	ticketsOpened: number;
	messagesTotal: number;
	voiceMinutesTotal: number;
}

export interface MemberSearchQuery extends PaginationQuery {
	/** Recherche libre sur le pseudo, le nom global ou l'identifiant. */
	search?: string;
	status?: MemberStatus;
	roleId?: Snowflake;
	hasActiveSanction?: boolean;
	minWarnings?: number;
	joinedAfter?: IsoDateString;
	joinedBefore?: IsoDateString;
	sortBy?: MemberSortField;
	sortDir?: "asc" | "desc";
}

export type MemberSortField =
	| "username"
	| "joinedAt"
	| "warningCount"
	| "messageCount30d"
	| "lastActiveAt";

/**
 * Entree unifiee de la chronologie d'un membre : avertissements, sanctions,
 * notes, changements de role et d'identite fusionnes puis tries par date.
 */
export interface TimelineEntry {
	id: string;
	kind: TimelineKind;
	occurredAt: IsoDateString;
	title: string;
	description: string | null;
	/** Auteur affichable de l'evenement, quand il est connu. */
	actorLabel: string | null;
	/** Donnees specifiques au type, pour l'affichage detaille. */
	payload: Record<string, unknown> | null;
}

export const TimelineKind = {
	WARNING: "WARNING",
	SANCTION: "SANCTION",
	NOTE: "NOTE",
	ROLE: "ROLE",
	IDENTITY: "IDENTITY",
	JOIN: "JOIN",
	LEAVE: "LEAVE",
	TICKET: "TICKET",
} as const;
export type TimelineKind = (typeof TimelineKind)[keyof typeof TimelineKind];

export interface TimelineQuery extends PaginationQuery {
	kinds?: TimelineKind[];
	from?: IsoDateString;
	to?: IsoDateString;
}
