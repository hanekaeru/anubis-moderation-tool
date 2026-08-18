import {
	TicketCategory,
	TicketEventType,
	TicketPriority,
	TicketStatus,
} from "../enums";
import { IsoDateString, PaginationQuery, Snowflake } from "./common";
import { ActorRef, MemberRef } from "./moderation";

export interface TicketListItem {
	id: string;
	number: number;
	subject: string;
	category: TicketCategory;
	status: TicketStatus;
	priority: TicketPriority;
	opener: MemberRef;
	assignee: MemberRef | null;
	openedAt: IsoDateString;
	/** Prise en charge, depuis le bouton du bot ou depuis le dashboard. */
	claimedAt: IsoDateString | null;
	closedAt: IsoDateString | null;
	messageCount: number;
	/** Delai avant la premiere reponse du staff, en secondes. */
	firstResponseSeconds: number | null;
	/** Duree totale de traitement, en secondes ; null si encore ouvert. */
	resolutionSeconds: number | null;
	rating: number | null;
}

export interface TicketDetail extends TicketListItem {
	guildId: Snowflake;
	channelId: Snowflake | null;
	/** Compte dashboard ou moderateur Discord, selon d'ou vient la prise. */
	claimedBy: ActorRef | null;
	closedBy: ActorRef | null;
	closeReason: string | null;
	events: TicketEventDto[];
}

/**
 * `payload` selon `type` :
 * - `MESSAGE` : `{ content: string | null; attachments: TicketAttachmentRef[] }`
 * - `STATUS_CHANGED` / `PRIORITY_CHANGED` / `ASSIGNED` : `{ from; to }`
 * - `INTERNAL_NOTE` : `{ body: string }`
 * - `TRANSCRIPT_ARCHIVED` : `{ channelName: string; transcriptPosted: boolean }`
 */
export interface TicketEventDto {
	id: string;
	type: TicketEventType;
	actor: ActorRef | null;
	payload: Record<string, unknown> | null;
	occurredAt: IsoDateString;
}

/** Metadonnees d'une piece jointe telechargee par le bot (jamais les octets). */
export interface TicketAttachmentRef {
	id: string;
	fileName: string;
	contentType: string;
	size: number;
}

export interface TicketSearchQuery extends PaginationQuery {
	search?: string;
	status?: TicketStatus;
	priority?: TicketPriority;
	category?: TicketCategory;
	assigneeId?: Snowflake;
	openerId?: Snowflake;
	from?: IsoDateString;
	to?: IsoDateString;
	sortBy?: "openedAt" | "closedAt" | "priority" | "number";
	sortDir?: "asc" | "desc";
}

export interface UpdateTicketRequest {
	status?: TicketStatus;
	priority?: TicketPriority;
	category?: TicketCategory;
	assigneeId?: Snowflake | null;
	closeReason?: string;
}

export interface AddTicketNoteRequest {
	body: string;
}

/**
 * Sujet propose a l'ouverture d'un ticket.
 *
 * `category` retient la grande famille a laquelle le sujet appartient : le
 * dashboard filtre et compte par famille, la ou le membre choisit un libelle
 * precis dans Discord.
 */
export interface TicketSubjectDto {
	id: string;
	label: string;
	description: string | null;
	emoji: string | null;
	category: TicketCategory;
	defaultPriority: TicketPriority;
	position: number;
	enabled: boolean;
}

export interface CreateTicketSubjectRequest {
	label: string;
	description?: string | null;
	emoji?: string | null;
	category?: TicketCategory;
	defaultPriority?: TicketPriority;
	position?: number;
	enabled?: boolean;
}

export interface UpdateTicketSubjectRequest {
	label?: string;
	description?: string | null;
	emoji?: string | null;
	category?: TicketCategory;
	defaultPriority?: TicketPriority;
	position?: number;
	enabled?: boolean;
}

/** Prefixe donne par un moderateur aux salons des tickets qu'il prend. */
export interface TicketModeratorPrefixDto {
	userId: Snowflake;
	username: string;
	displayName: string | null;
	avatarUrl: string | null;
	prefix: string;
	updatedAt: IsoDateString;
	/** Tickets encore ouverts pris en charge par ce moderateur. */
	openTickets: number;
}

export interface UpsertTicketPrefixRequest {
	prefix: string;
}

export interface TicketConfigDto {
	/** Tickets non fermes qu'un meme membre peut avoir a la fois. */
	maxOpenTickets: number;
	updatedAt: IsoDateString | null;
}

export interface UpdateTicketConfigRequest {
	maxOpenTickets?: number;
}

/** Valeur de repli quand aucune ligne `TicketConfig` n'existe pour le serveur. */
export const DEFAULT_MAX_OPEN_TICKETS = 1;

/** Bornes du reglage : au-dela, un membre pourrait noyer le staff a lui seul. */
export const MIN_MAX_OPEN_TICKETS = 1;
export const MAX_MAX_OPEN_TICKETS = 10;

/** Longueur du prefixe d'un moderateur, une fois normalise. */
export const MAX_TICKET_PREFIX_LENGTH = 12;

/** Sujets proposables : plafond d'options d'un select menu Discord. */
export const MAX_TICKET_SUBJECTS = 25;

/** Description libre saisie a l'ouverture, reprise dans l'embed d'accueil. */
export const MAX_TICKET_DESCRIPTION_LENGTH = 1000;

/**
 * Normalise un fragment de nom de salon Discord.
 *
 * Discord met les noms de salon textuel en minuscules et remplace ce qu'il ne
 * comprend pas : normaliser ici plutot que de le laisser faire evite qu'un
 * pseudo accentue ou plein d'emojis rende le nom illisible — et surtout que le
 * nom stocke en base differe de celui reellement affiche.
 */
export function slugifyChannelPart(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Numero de ticket tel qu'il apparait dans les noms de salon. */
export function formatTicketNumber(number: number): string {
	return String(number).padStart(4, "0");
}

/**
 * Nom du salon d'un ticket pris en charge : `prefixe-pseudo-numero`.
 *
 * Discord plafonne un nom de salon a 100 caracteres, mais un nom trop long est
 * surtout illisible dans la barre laterale : le pseudo est le seul fragment
 * qu'on peut raccourcir sans perdre d'information — le prefixe designe le
 * moderateur, le numero retrouve le ticket.
 */
export function claimedTicketChannelName(
	prefix: string,
	openerUsername: string,
	number: number,
): string {
	const prefixePart = slugifyChannelPart(prefix);
	const pseudoPart = slugifyChannelPart(openerUsername).slice(0, 20) || "membre";

	return [prefixePart, pseudoPart, formatTicketNumber(number)]
		.filter(Boolean)
		.join("-");
}

/** Nom du salon avant toute prise en charge. */
export function newTicketChannelName(number: number): string {
	return `ticket-${formatTicketNumber(number)}`;
}
