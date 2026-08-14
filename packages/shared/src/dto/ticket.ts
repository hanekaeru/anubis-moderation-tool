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
