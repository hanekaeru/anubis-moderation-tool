import { Injectable } from '@nestjs/common';
import { Prisma } from '@anubis/shared/prisma';
import {
  STATS_PERIOD_DAYS,
  WEEKDAY_LABELS,
  type CategoryCount,
  type DashboardOverview,
  type HeatmapCell,
  type MemberActivityStats,
  type ModeratorActivity,
  type RecentSanction,
  type StatsPeriod,
  type TicketStatsSummary,
  type TimeSeriesPoint,
} from '@anubis/shared';
import { GuildContextService } from '../common/guild-context.service';
import { dayKey, fillDailySeries, toMemberRef } from '../common/mappers';
import { PrismaService } from '../prisma/prisma.service';

interface DailyCountRow {
  day: Date;
  count: bigint;
}

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guild: GuildContextService,
  ) {}

  private range(period: StatsPeriod): { from: Date; to: Date } {
    const to = new Date();
    const from = new Date(to.getTime() - STATS_PERIOD_DAYS[period] * 86_400_000);
    return { from, to };
  }

  /**
   * Compte par jour sur une table quelconque.
   *
   * Le nom de table et de colonne viennent exclusivement du code appelant, pas
   * d'une entree utilisateur — c'est ce qui rend l'interpolation `Prisma.raw`
   * acceptable ici. Toutes les valeurs, elles, restent parametrees.
   */
  private async dailyCounts(
    table: string,
    dateColumn: string,
    from: Date,
    to: Date,
    extraWhere: Prisma.Sql = Prisma.empty,
  ): Promise<TimeSeriesPoint[]> {
    const rows = await this.prisma.$queryRaw<DailyCountRow[]>`
      SELECT date_trunc('day', ${Prisma.raw(dateColumn)}) AS day, COUNT(*) AS count
      FROM ${Prisma.raw(table)}
      WHERE guild_id = ${this.guild.guildId}
        AND ${Prisma.raw(dateColumn)} >= ${from}
        AND ${Prisma.raw(dateColumn)} <= ${to}
        ${extraWhere}
      GROUP BY 1
      ORDER BY 1
    `;

    const counts = new Map<string, number>(
      rows.map((row) => [dayKey(row.day), Number(row.count)]),
    );

    return fillDailySeries(counts, from, to);
  }

  async memberActivity(
    userId: string,
    period: StatsPeriod,
  ): Promise<MemberActivityStats> {
    const guildId = this.guild.guildId;
    const { from, to } = this.range(period);

    const [dailyStats, channelStats, profile, voiceSessions, totals] =
      await Promise.all([
        this.prisma.messageStat.groupBy({
          by: ['day'],
          where: { guildId, userId, day: { gte: from, lte: to } },
          _sum: { messageCount: true },
        }),
        this.prisma.messageStat.groupBy({
          by: ['channelId'],
          where: { guildId, userId, day: { gte: from, lte: to } },
          _sum: { messageCount: true },
        }),
        this.prisma.memberActivityProfile.findMany({
          where: { guildId, userId },
        }),
        this.prisma.voiceSession.findMany({
          where: { guildId, userId, joinedAt: { gte: from, lte: to } },
          select: { joinedAt: true, durationSeconds: true },
        }),
        this.prisma.messageStat.aggregate({
          where: { guildId, userId, day: { gte: from, lte: to } },
          _sum: { messageCount: true, totalCharacters: true },
        }),
      ]);

    const messagesPerDay = fillDailySeries(
      new Map(
        dailyStats.map((row) => [
          dayKey(row.day),
          row._sum.messageCount ?? 0,
        ]),
      ),
      from,
      to,
    );

    const voiceByDay = new Map<string, number>();
    for (const session of voiceSessions) {
      const key = dayKey(session.joinedAt);
      const minutes = Math.round((session.durationSeconds ?? 0) / 60);
      voiceByDay.set(key, (voiceByDay.get(key) ?? 0) + minutes);
    }
    const voiceMinutesPerDay = fillDailySeries(voiceByDay, from, to);

    // Noms de canaux resolus en une requete pour les seuls canaux concernes.
    const channelIds = channelStats.map((row) => row.channelId);
    const channels = channelIds.length
      ? await this.prisma.channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, name: true },
        })
      : [];
    const channelNames = new Map(channels.map((c) => [c.id, c.name]));

    const messagesByChannel: CategoryCount[] = channelStats
      .map((row) => ({
        key: row.channelId,
        label: channelNames.get(row.channelId) ?? 'Canal supprime',
        value: row._sum.messageCount ?? 0,
      }))
      .sort((a, b) => b.value - a.value);

    const hourTotals = new Array<number>(24).fill(0);
    const weekdayTotals = new Array<number>(7).fill(0);
    const heatmap: HeatmapCell[] = [];

    for (const cell of profile) {
      hourTotals[cell.hour] = (hourTotals[cell.hour] ?? 0) + cell.messageCount;
      weekdayTotals[cell.weekday] =
        (weekdayTotals[cell.weekday] ?? 0) + cell.messageCount;
      heatmap.push({
        weekday: cell.weekday,
        hour: cell.hour,
        value: cell.messageCount,
      });
    }

    const messages = totals._sum.messageCount ?? 0;
    const characters = Number(totals._sum.totalCharacters ?? 0n);
    const activeDays = messagesPerDay.filter((point) => point.value > 0).length;

    return {
      userId,
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      messagesPerDay,
      voiceMinutesPerDay,
      messagesByChannel,
      messagesByHour: hourTotals.map((value, hour) => ({
        key: String(hour),
        label: `${String(hour).padStart(2, '0')}h`,
        value,
      })),
      messagesByWeekday: weekdayTotals.map((value, index) => ({
        key: String(index),
        label: WEEKDAY_LABELS[index] ?? '',
        value,
      })),
      heatmap,
      totals: {
        messages,
        voiceMinutes: voiceMinutesPerDay.reduce((sum, p) => sum + p.value, 0),
        activeDays,
        averageMessagesPerActiveDay: activeDays
          ? Math.round((messages / activeDays) * 10) / 10
          : 0,
        averageMessageLength: messages
          ? Math.round(characters / messages)
          : 0,
      },
    };
  }

  async overview(period: StatsPeriod): Promise<DashboardOverview> {
    const guildId = this.guild.guildId;
    const { from, to } = this.range(period);

    const [
      memberCount,
      activeMemberCount,
      joinsPerDay,
      leavesPerDay,
      warningsPerDay,
      messageRows,
      sanctionsByType,
      ticketsByStatus,
      openTicketCount,
      activeSanctionCount,
      recentSanctionRows,
    ] = await Promise.all([
      this.prisma.member.count({ where: { guildId } }),
      this.prisma.member.count({ where: { guildId, status: 'ACTIVE' } }),
      this.dailyCounts('members', 'joined_at', from, to),
      this.dailyCounts('members', 'left_at', from, to),
      this.dailyCounts('warnings', 'created_at', from, to),
      this.prisma.messageStat.groupBy({
        by: ['day'],
        where: { guildId, day: { gte: from, lte: to } },
        _sum: { messageCount: true },
      }),
      this.prisma.sanction.groupBy({
        by: ['type'],
        where: { guildId, createdAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: { guildId },
        _count: { _all: true },
      }),
      this.prisma.ticket.count({
        where: { guildId, status: { in: ['OPEN', 'PENDING'] } },
      }),
      this.prisma.sanction.count({ where: { guildId, status: 'ACTIVE' } }),
      this.prisma.sanction.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { user: true, moderator: true, createdBy: true },
      }),
    ]);

    const messagesPerDay = fillDailySeries(
      new Map(
        messageRows.map((row) => [dayKey(row.day), row._sum.messageCount ?? 0]),
      ),
      from,
      to,
    );

    const recentSanctions: RecentSanction[] = recentSanctionRows.map((row) => ({
      id: row.id,
      member: toMemberRef(row.user),
      type: row.type,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      issuedByLabel:
        row.createdBy?.displayName ??
        row.moderator?.globalName ??
        row.moderator?.username ??
        'Systeme',
    }));

    return {
      period,
      memberCount,
      activeMemberCount,
      joinsPerDay,
      leavesPerDay,
      messagesPerDay,
      warningsPerDay,
      sanctionsByType: sanctionsByType.map((row) => ({
        key: row.type,
        label: row.type,
        value: row._count._all,
      })),
      ticketsByStatus: ticketsByStatus.map((row) => ({
        key: row.status,
        label: row.status,
        value: row._count._all,
      })),
      openTicketCount,
      activeSanctionCount,
      medianFirstResponseSeconds: await this.medianFirstResponse(from, to),
      moderatorLeaderboard: await this.moderatorLeaderboard(from, to),
      recentSanctions,
    };
  }

  /**
   * Mediane plutot que moyenne : un seul ticket oublie pendant trois jours
   * suffirait a rendre une moyenne inexploitable.
   */
  private async medianFirstResponse(
    from: Date,
    to: Date,
  ): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<{ median: number | null }[]>`
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (first_response_at - opened_at))
             ) AS median
      FROM tickets
      WHERE guild_id = ${this.guild.guildId}
        AND first_response_at IS NOT NULL
        AND opened_at >= ${from}
        AND opened_at <= ${to}
    `;

    const median = rows[0]?.median;
    return median === null || median === undefined ? null : Math.round(median);
  }

  private async moderatorLeaderboard(
    from: Date,
    to: Date,
  ): Promise<ModeratorActivity[]> {
    const rows = await this.prisma.moderationActivity.groupBy({
      by: ['appUserId', 'moderatorId', 'action'],
      where: {
        guildId: this.guild.guildId,
        occurredAt: { gte: from, lte: to },
      },
      _count: { _all: true },
    });

    const byActor = new Map<string, ModeratorActivity>();

    for (const row of rows) {
      const key = row.appUserId ?? row.moderatorId ?? 'system';
      const entry = byActor.get(key) ?? {
        moderator: null,
        appUserId: row.appUserId,
        displayName: key,
        warnings: 0,
        sanctions: 0,
        ticketsClosed: 0,
        notes: 0,
        total: 0,
      };

      const count = row._count._all;
      if (row.action === 'warn') entry.warnings += count;
      else if (row.action.startsWith('sanction.')) entry.sanctions += count;
      else if (row.action === 'ticket.close') entry.ticketsClosed += count;
      else if (row.action.startsWith('note.')) entry.notes += count;
      entry.total += count;

      byActor.set(key, entry);
    }

    // Les libelles sont resolus apres coup, pour ne pas jointer dans le groupBy.
    const appUserIds = [...byActor.values()]
      .map((entry) => entry.appUserId)
      .filter((id): id is string => id !== null);

    const appUsers = appUserIds.length
      ? await this.prisma.appUser.findMany({
          where: { id: { in: appUserIds } },
          select: { id: true, displayName: true },
        })
      : [];

    const names = new Map(appUsers.map((user) => [user.id, user.displayName]));

    for (const entry of byActor.values()) {
      if (entry.appUserId) {
        entry.displayName = names.get(entry.appUserId) ?? 'Compte supprime';
      }
    }

    return [...byActor.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }

  async ticketStats(period: StatsPeriod): Promise<TicketStatsSummary> {
    const guildId = this.guild.guildId;
    const { from, to } = this.range(period);

    const [openedPerDay, closedPerDay, byCategory, byStatusRows, aggregates] =
      await Promise.all([
        this.dailyCounts('tickets', 'opened_at', from, to),
        this.dailyCounts('tickets', 'closed_at', from, to),
        this.prisma.ticket.groupBy({
          by: ['category'],
          where: { guildId, openedAt: { gte: from, lte: to } },
          _count: { _all: true },
        }),
        this.prisma.ticket.groupBy({
          by: ['status'],
          where: { guildId },
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<
          { avg_resolution: number | null; avg_rating: number | null }[]
        >`
          SELECT AVG(EXTRACT(EPOCH FROM (closed_at - opened_at))) AS avg_resolution,
                 AVG(rating)::float AS avg_rating
          FROM tickets
          WHERE guild_id = ${guildId}
            AND closed_at IS NOT NULL
            AND opened_at >= ${from}
            AND opened_at <= ${to}
        `,
      ]);

    const byStatus = {
      OPEN: 0,
      PENDING: 0,
      RESOLVED: 0,
      CLOSED: 0,
    };

    for (const row of byStatusRows) {
      byStatus[row.status] = row._count._all;
    }

    const stats = aggregates[0];

    return {
      period,
      openedPerDay,
      closedPerDay,
      byCategory: byCategory.map((row) => ({
        key: row.category,
        label: row.category,
        value: row._count._all,
      })),
      byStatus,
      averageResolutionSeconds: stats?.avg_resolution
        ? Math.round(stats.avg_resolution)
        : null,
      averageRating: stats?.avg_rating
        ? Math.round(stats.avg_rating * 10) / 10
        : null,
    };
  }
}
