import {
  IdentityEventType,
  MemberStatus,
  RoleEventType,
} from '../enums';
import { IsoDateString, PaginationQuery, Snowflake } from './common';

export interface RoleSummary {
  id: Snowflake;
  name: string;
  /** Couleur Discord en entier ; 0 signifie "pas de couleur". */
  color: number;
  position: number;
  managed: boolean;
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
  sortDir?: 'asc' | 'desc';
}

export type MemberSortField =
  | 'username'
  | 'joinedAt'
  | 'warningCount'
  | 'messageCount30d'
  | 'lastActiveAt';

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
  WARNING: 'WARNING',
  SANCTION: 'SANCTION',
  NOTE: 'NOTE',
  ROLE: 'ROLE',
  IDENTITY: 'IDENTITY',
  JOIN: 'JOIN',
  LEAVE: 'LEAVE',
  TICKET: 'TICKET',
} as const;
export type TimelineKind = (typeof TimelineKind)[keyof typeof TimelineKind];

export interface TimelineQuery extends PaginationQuery {
  kinds?: TimelineKind[];
  from?: IsoDateString;
  to?: IsoDateString;
}

export interface IdentityEventDto {
  id: string;
  type: IdentityEventType;
  oldValue: string | null;
  newValue: string | null;
  occurredAt: IsoDateString;
}

export interface RoleEventDto {
  id: string;
  type: RoleEventType;
  role: RoleSummary;
  actorLabel: string | null;
  occurredAt: IsoDateString;
}
