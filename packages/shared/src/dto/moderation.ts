import { SanctionStatus, SanctionType, WarningSeverity } from "../enums";
import { IsoDateString, PaginationQuery, Snowflake } from "./common";

/** Reference courte vers un membre, pour ne pas dupliquer la fiche complete. */
export interface MemberRef {
	userId: Snowflake;
	username: string;
	globalName: string | null;
	avatarUrl: string | null;
}

/** Auteur d'une action : soit un moderateur Discord, soit un compte dashboard. */
export interface ActorRef {
	kind: "discord" | "app" | "system";
	id: string | null;
	label: string;
}

export interface WarningDto {
	id: string;
	guildId: Snowflake;
	member: MemberRef;
	issuedBy: ActorRef;
	reason: string;
	severity: WarningSeverity;
	points: number;
	expiresAt: IsoDateString | null;
	revokedAt: IsoDateString | null;
	revokedBy: ActorRef | null;
	revokeReason: string | null;
	createdAt: IsoDateString;
	/** Ni revoque, ni expire. */
	isActive: boolean;
}

export interface CreateWarningRequest {
	userId: Snowflake;
	reason: string;
	severity: WarningSeverity;
	points?: number;
	expiresAt?: IsoDateString | null;
}

export interface RevokeRequest {
	reason: string;
}

export interface WarningSearchQuery extends PaginationQuery {
	userId?: Snowflake;
	severity?: WarningSeverity;
	activeOnly?: boolean;
	from?: IsoDateString;
	to?: IsoDateString;
}

export interface SanctionDto {
	id: string;
	guildId: Snowflake;
	member: MemberRef;
	issuedBy: ActorRef;
	type: SanctionType;
	status: SanctionStatus;
	reason: string;
	durationSeconds: number | null;
	startsAt: IsoDateString;
	expiresAt: IsoDateString | null;
	revokedAt: IsoDateString | null;
	revokedBy: ActorRef | null;
	revokeReason: string | null;
	warningId: string | null;
	evidenceUrl: string | null;
	createdAt: IsoDateString;
}

export interface CreateSanctionRequest {
	userId: Snowflake;
	type: SanctionType;
	reason: string;
	/** Null ou absent = sanction permanente. */
	durationSeconds?: number | null;
	warningId?: string | null;
	evidenceUrl?: string | null;
}

export interface SanctionSearchQuery extends PaginationQuery {
	userId?: Snowflake;
	type?: SanctionType;
	status?: SanctionStatus;
	from?: IsoDateString;
	to?: IsoDateString;
}

export interface NoteDto {
	id: string;
	guildId: Snowflake;
	userId: Snowflake;
	author: ActorRef;
	body: string;
	pinned: boolean;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
	/** Vrai si le compte connecte peut modifier ou supprimer cette note. */
	canEdit: boolean;
}

export interface CreateNoteRequest {
	userId: Snowflake;
	body: string;
	pinned?: boolean;
}

export interface UpdateNoteRequest {
	body?: string;
	pinned?: boolean;
}

/** Durees proposees dans les formulaires de sanction, en secondes. */
export const SANCTION_DURATION_PRESETS: ReadonlyArray<{
	label: string;
	seconds: number | null;
}> = [
	{ label: "60 secondes", seconds: 60 },
	{ label: "5 minutes", seconds: 5 * 60 },
	{ label: "10 minutes", seconds: 10 * 60 },
	{ label: "1 heure", seconds: 60 * 60 },
	{ label: "1 jour", seconds: 24 * 60 * 60 },
	{ label: "1 semaine", seconds: 7 * 24 * 60 * 60 },
	{ label: "28 jours", seconds: 28 * 24 * 60 * 60 },
	{ label: "Permanent", seconds: null },
];

/**
 * Discord plafonne les exclusions temporaires a 28 jours. La contrainte est
 * declaree ici pour que le formulaire et l'API l'appliquent a l'identique.
 */
export const MAX_TIMEOUT_SECONDS = 28 * 24 * 60 * 60;

/** Types de sanction qui n'ont pas de duree. */
export const INSTANT_SANCTION_TYPES: readonly SanctionType[] = [
	"KICK",
	"SOFTBAN",
];
