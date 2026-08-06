import { TicketEventType, TicketPriority, TicketStatus } from '../enums';
import { IsoDateString, PaginationQuery, Snowflake } from './common';
import { ActorRef, MemberRef } from './moderation';

export interface TicketListItem {
  id: string;
  number: number;
  subject: string;
  category: string;
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

export interface TicketEventDto {
  id: string;
  type: TicketEventType;
  actor: ActorRef | null;
  payload: Record<string, unknown> | null;
  occurredAt: IsoDateString;
}

export interface TicketSearchQuery extends PaginationQuery {
  search?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: string;
  assigneeId?: Snowflake;
  openerId?: Snowflake;
  from?: IsoDateString;
  to?: IsoDateString;
  sortBy?: 'openedAt' | 'closedAt' | 'priority' | 'number';
  sortDir?: 'asc' | 'desc';
}

export interface UpdateTicketRequest {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: string;
  assigneeId?: Snowflake | null;
  closeReason?: string;
}

export interface AddTicketNoteRequest {
  body: string;
}
