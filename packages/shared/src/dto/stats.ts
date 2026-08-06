import { SanctionType, TicketStatus } from '../enums';
import { IsoDateString, Snowflake } from './common';
import { MemberRef } from './moderation';

/** Un point d'une serie temporelle. `date` est un jour au format YYYY-MM-DD. */
export interface TimeSeriesPoint {
  date: string;
  value: number;
}

export interface NamedSeries {
  name: string;
  points: TimeSeriesPoint[];
}

export interface CategoryCount {
  key: string;
  label: string;
  value: number;
}

/** Une case de la carte de chaleur d'activite. */
export interface HeatmapCell {
  /** 0 = lundi, 6 = dimanche. */
  weekday: number;
  /** 0 a 23, en UTC. */
  hour: number;
  value: number;
}

export const WEEKDAY_LABELS = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
] as const;

export type StatsPeriod = '7d' | '30d' | '90d' | '365d';

export const STATS_PERIOD_DAYS: Record<StatsPeriod, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '365d': 365,
};

export const STATS_PERIOD_LABELS: Record<StatsPeriod, string> = {
  '7d': '7 jours',
  '30d': '30 jours',
  '90d': '90 jours',
  '365d': '1 an',
};

export interface StatsQuery {
  period?: StatsPeriod;
}

/** Ce qui alimente les graphiques de la fiche membre. */
export interface MemberActivityStats {
  userId: Snowflake;
  period: StatsPeriod;
  from: IsoDateString;
  to: IsoDateString;
  /** Messages par jour, jours vides inclus pour un trace continu. */
  messagesPerDay: TimeSeriesPoint[];
  /** Minutes de vocal par jour. */
  voiceMinutesPerDay: TimeSeriesPoint[];
  /** Repartition des messages par canal, du plus actif au moins actif. */
  messagesByChannel: CategoryCount[];
  /** Repartition par heure de la journee (0 a 23, UTC). */
  messagesByHour: CategoryCount[];
  /** Repartition par jour de semaine (0 = lundi). */
  messagesByWeekday: CategoryCount[];
  /** Carte de chaleur jour de semaine x heure. */
  heatmap: HeatmapCell[];
  totals: {
    messages: number;
    voiceMinutes: number;
    activeDays: number;
    averageMessagesPerActiveDay: number;
    averageMessageLength: number;
  };
}

/** Ecran d'accueil du dashboard. */
export interface DashboardOverview {
  period: StatsPeriod;
  memberCount: number;
  activeMemberCount: number;
  joinsPerDay: TimeSeriesPoint[];
  leavesPerDay: TimeSeriesPoint[];
  messagesPerDay: TimeSeriesPoint[];
  warningsPerDay: TimeSeriesPoint[];
  sanctionsByType: CategoryCount[];
  ticketsByStatus: CategoryCount[];
  openTicketCount: number;
  activeSanctionCount: number;
  /** Delai median de premiere reponse sur les tickets, en secondes. */
  medianFirstResponseSeconds: number | null;
  moderatorLeaderboard: ModeratorActivity[];
  recentSanctions: RecentSanction[];
}

export interface ModeratorActivity {
  moderator: MemberRef | null;
  appUserId: string | null;
  displayName: string;
  warnings: number;
  sanctions: number;
  ticketsClosed: number;
  notes: number;
  total: number;
}

export interface RecentSanction {
  id: string;
  member: MemberRef;
  type: SanctionType;
  reason: string;
  createdAt: IsoDateString;
  issuedByLabel: string;
}

export interface TicketStatsSummary {
  period: StatsPeriod;
  openedPerDay: TimeSeriesPoint[];
  closedPerDay: TimeSeriesPoint[];
  byCategory: CategoryCount[];
  byStatus: Record<TicketStatus, number>;
  averageResolutionSeconds: number | null;
  averageRating: number | null;
}
