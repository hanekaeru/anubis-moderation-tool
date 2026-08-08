import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@anubis/shared/prisma';
import {
  avatarUrl,
  snowflakeToDate,
  TimelineKind,
  type MemberCounters,
  type MemberDetail,
  type MemberListItem,
  type MemberSortField,
  type Paginated,
  type RoleSummary,
  type TimelineEntry,
} from '@anubis/shared';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';
import { GuildContextService } from '../common/guild-context.service';
import { sortRoles, toRoleSummary } from '../common/mappers';
import type { AuthenticatedUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import type { MemberQueryDto, TimelineQueryDto } from './dto/member-query.dto';

/** Ligne brute renvoyee par la requete de recherche. */
interface MemberSearchRow {
  user_id: string;
  username: string;
  global_name: string | null;
  nickname: string | null;
  avatar_hash: string | null;
  status: 'ACTIVE' | 'LEFT' | 'BANNED';
  joined_at: Date | null;
  warning_count: number;
  active_sanction_count: number;
  message_count_30d: number;
  last_active_at: Date | null;
  total_count: bigint;
}

/**
 * Colonnes de tri autorisees. La valeur passe telle quelle dans le SQL, donc
 * elle ne doit jamais venir directement de l'utilisateur : cette table blanche
 * est la seule porte d'entree.
 */
const SORT_COLUMNS: Record<MemberSortField, string> = {
  username: 'du.username',
  joinedAt: 'm.joined_at',
  warningCount: 'warning_count',
  messageCount30d: 'message_count_30d',
  lastActiveAt: 'last_active_at',
};

/** Plafond par source lors de la construction d'une chronologie. */
const TIMELINE_SOURCE_LIMIT = 500;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guild: GuildContextService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Recherche paginee.
   *
   * C'est le seul endroit du projet ou l'on ecrit du SQL a la main : agreger
   * avertissements, sanctions et activite puis trier et paginer sur le resultat
   * demande une seule requete, la ou l'API Prisma en imposerait plusieurs avec
   * un tri incomplet. Tout le reste passe par Prisma.
   */
  async search(query: MemberQueryDto): Promise<Paginated<MemberListItem>> {
    const guildId = this.guild.guildId;
    const conditions: Prisma.Sql[] = [Prisma.sql`m.guild_id = ${guildId}`];

    if (query.search) {
      const like = `%${query.search}%`;
      conditions.push(
        Prisma.sql`(du.username ILIKE ${like} OR du.global_name ILIKE ${like} OR m.nickname ILIKE ${like} OR m.user_id = ${query.search})`,
      );
    }

    if (query.status) {
      conditions.push(
        Prisma.sql`m.status = ${query.status}::"MemberStatus"`,
      );
    }

    if (query.roleId) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM member_roles mr WHERE mr.guild_id = m.guild_id AND mr.user_id = m.user_id AND mr.role_id = ${query.roleId})`,
      );
    }

    if (query.hasActiveSanction !== undefined) {
      const exists = Prisma.sql`EXISTS (SELECT 1 FROM sanctions s WHERE s.guild_id = m.guild_id AND s.user_id = m.user_id AND s.status = 'ACTIVE')`;
      conditions.push(
        query.hasActiveSanction ? exists : Prisma.sql`NOT ${exists}`,
      );
    }

    if (query.joinedAfter) {
      conditions.push(Prisma.sql`m.joined_at >= ${new Date(query.joinedAfter)}`);
    }

    if (query.joinedBefore) {
      conditions.push(Prisma.sql`m.joined_at <= ${new Date(query.joinedBefore)}`);
    }

    const where = Prisma.join(conditions, ' AND ');

    // Filtre sur un agregat : il porte sur le resultat des CTE, donc il ne peut
    // pas vivre dans le WHERE principal.
    const havingWarnings = query.minWarnings
      ? Prisma.sql`AND COALESCE(warn.c, 0) >= ${query.minWarnings}`
      : Prisma.empty;

    const orderColumn = SORT_COLUMNS[query.sortBy] ?? SORT_COLUMNS.username;
    const direction = query.sortDir === 'desc' ? 'DESC' : 'ASC';
    const orderBy = Prisma.raw(`${orderColumn} ${direction} NULLS LAST`);

    const rows = await this.prisma.$queryRaw<MemberSearchRow[]>`
      WITH warn AS (
        SELECT user_id, COUNT(*)::int AS c
        FROM warnings
        WHERE guild_id = ${guildId} AND revoked_at IS NULL
        GROUP BY user_id
      ),
      sanc AS (
        SELECT user_id, COUNT(*)::int AS c
        FROM sanctions
        WHERE guild_id = ${guildId} AND status = 'ACTIVE'
        GROUP BY user_id
      ),
      msg AS (
        SELECT user_id,
               SUM(message_count)::int AS c,
               MAX(day) AS last_day
        FROM message_stats
        WHERE guild_id = ${guildId} AND day >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY user_id
      )
      SELECT m.user_id,
             du.username,
             du.global_name,
             m.nickname,
             du.avatar_hash,
             m.status,
             m.joined_at,
             COALESCE(warn.c, 0) AS warning_count,
             COALESCE(sanc.c, 0) AS active_sanction_count,
             COALESCE(msg.c, 0)  AS message_count_30d,
             msg.last_day        AS last_active_at,
             COUNT(*) OVER()     AS total_count
      FROM members m
      JOIN discord_users du ON du.id = m.user_id
      LEFT JOIN warn ON warn.user_id = m.user_id
      LEFT JOIN sanc ON sanc.user_id = m.user_id
      LEFT JOIN msg  ON msg.user_id  = m.user_id
      WHERE ${where} ${havingWarnings}
      ORDER BY ${orderBy}
      LIMIT ${query.take} OFFSET ${query.skip}
    `;

    const total = rows.length ? Number(rows[0]!.total_count) : 0;
    const rolesByUser = await this.rolesForUsers(rows.map((row) => row.user_id));

    const items: MemberListItem[] = rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      globalName: row.global_name,
      nickname: row.nickname,
      avatarUrl: avatarUrl(row.user_id, row.avatar_hash),
      status: row.status,
      joinedAt: row.joined_at?.toISOString() ?? null,
      roles: rolesByUser.get(row.user_id) ?? [],
      warningCount: row.warning_count,
      activeSanctionCount: row.active_sanction_count,
      messageCount30d: row.message_count_30d,
      lastActiveAt: row.last_active_at?.toISOString() ?? null,
    }));

    return paginate(items, total, query);
  }

  /** Roles de plusieurs membres en une requete, pour eviter un N+1. */
  private async rolesForUsers(
    userIds: string[],
  ): Promise<Map<string, RoleSummary[]>> {
    const result = new Map<string, RoleSummary[]>();
    if (!userIds.length) return result;

    const rows = await this.prisma.memberRole.findMany({
      where: { guildId: this.guild.guildId, userId: { in: userIds } },
      include: { role: true },
    });

    for (const row of rows) {
      if (row.role.deletedAt) continue;
      const list = result.get(row.userId) ?? [];
      list.push(toRoleSummary(row.role));
      result.set(row.userId, list);
    }

    for (const [userId, roles] of result) {
      result.set(userId, sortRoles(roles));
    }

    return result;
  }

  async findOne(userId: string): Promise<MemberDetail> {
    const guildId = this.guild.guildId;

    const member = await this.prisma.member.findUnique({
      where: { guildId_userId: { guildId, userId } },
      include: { user: true },
    });

    if (!member) {
      throw new NotFoundException(`Membre ${userId} introuvable sur ce serveur.`);
    }

    const [roles, counters, level] = await Promise.all([
      this.rolesForUsers([userId]),
      this.countersFor(userId),
      this.prisma.userLevel.findUnique({
        where: { userId_guildId: { userId, guildId } },
      }),
    ]);

    return {
      userId,
      guildId,
      username: member.user.username,
      globalName: member.user.globalName,
      nickname: member.nickname,
      avatarUrl: avatarUrl(userId, member.user.avatarHash, 256),
      isBot: member.user.isBot,
      status: member.status,
      // A defaut de date enregistree, elle se deduit du snowflake.
      accountCreatedAt: (
        member.user.accountCreatedAt ?? snowflakeToDate(userId)
      ).toISOString(),
      joinedAt: member.joinedAt?.toISOString() ?? null,
      leftAt: member.leftAt?.toISOString() ?? null,
      joinCount: member.joinCount,
      boostingSince: member.boostingSince?.toISOString() ?? null,
      roles: roles.get(userId) ?? [],
      xp: level ? Number(level.xp) : 0,
      counters,
    };
  }

  private async countersFor(userId: string): Promise<MemberCounters> {
    const guildId = this.guild.guildId;
    const now = new Date();

    const [
      warnings,
      activeWarnings,
      sanctions,
      activeSanctions,
      notes,
      ticketsOpened,
      messages,
      voice,
    ] = await Promise.all([
      this.prisma.warning.count({ where: { guildId, userId } }),
      this.prisma.warning.count({
        where: {
          guildId,
          userId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
      this.prisma.sanction.count({ where: { guildId, userId } }),
      this.prisma.sanction.count({
        where: { guildId, userId, status: 'ACTIVE' },
      }),
      this.prisma.memberNote.count({
        where: { guildId, userId, deletedAt: null },
      }),
      this.prisma.ticket.count({ where: { guildId, openerId: userId } }),
      this.prisma.messageStat.aggregate({
        where: { guildId, userId },
        _sum: { messageCount: true },
      }),
      this.prisma.voiceSession.aggregate({
        where: { guildId, userId },
        _sum: { durationSeconds: true },
      }),
    ]);

    return {
      warnings,
      activeWarnings,
      sanctions,
      activeSanctions,
      notes,
      ticketsOpened,
      messagesTotal: messages._sum.messageCount ?? 0,
      voiceMinutesTotal: Math.round((voice._sum.durationSeconds ?? 0) / 60),
    };
  }

  /**
   * Chronologie unifiee.
   *
   * Chaque source est lue separement puis fusionnee en memoire : les tables
   * n'ont ni la meme forme ni la meme cle, et un UNION SQL couterait en
   * lisibilite ce qu'il ferait gagner ici. Chaque source est plafonnee pour
   * qu'un membre tres actif ne fasse pas exploser la reponse.
   */
  async timeline(
    userId: string,
    query: TimelineQueryDto,
  ): Promise<Paginated<TimelineEntry>> {
    const guildId = this.guild.guildId;
    const wanted = new Set<TimelineKind>(
      query.kinds?.length ? query.kinds : Object.values(TimelineKind),
    );

    const range = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
    const hasRange = Boolean(query.from || query.to);

    const entries: TimelineEntry[] = [];

    if (wanted.has(TimelineKind.WARNING)) {
      const rows = await this.prisma.warning.findMany({
        where: { guildId, userId, ...(hasRange ? { createdAt: range } : {}) },
        orderBy: { createdAt: 'desc' },
        take: TIMELINE_SOURCE_LIMIT,
        include: { moderator: true, createdBy: true },
      });

      for (const row of rows) {
        entries.push({
          id: `warning:${row.id}`,
          kind: TimelineKind.WARNING,
          occurredAt: row.createdAt.toISOString(),
          title: `Avertissement (${row.severity.toLowerCase()})`,
          description: row.reason,
          actorLabel:
            row.createdBy?.displayName ??
            row.moderator?.globalName ??
            row.moderator?.username ??
            null,
          payload: {
            severity: row.severity,
            points: row.points,
            revoked: row.revokedAt !== null,
          },
        });
      }
    }

    if (wanted.has(TimelineKind.SANCTION)) {
      const rows = await this.prisma.sanction.findMany({
        where: { guildId, userId, ...(hasRange ? { createdAt: range } : {}) },
        orderBy: { createdAt: 'desc' },
        take: TIMELINE_SOURCE_LIMIT,
        include: { moderator: true, createdBy: true },
      });

      for (const row of rows) {
        entries.push({
          id: `sanction:${row.id}`,
          kind: TimelineKind.SANCTION,
          occurredAt: row.createdAt.toISOString(),
          title: `Sanction : ${row.type}`,
          description: row.reason,
          actorLabel:
            row.createdBy?.displayName ??
            row.moderator?.globalName ??
            row.moderator?.username ??
            null,
          payload: {
            type: row.type,
            status: row.status,
            durationSeconds: row.durationSeconds,
            expiresAt: row.expiresAt?.toISOString() ?? null,
          },
        });
      }
    }

    if (wanted.has(TimelineKind.NOTE)) {
      const rows = await this.prisma.memberNote.findMany({
        where: {
          guildId,
          userId,
          deletedAt: null,
          ...(hasRange ? { createdAt: range } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: TIMELINE_SOURCE_LIMIT,
        include: { author: true },
      });

      for (const row of rows) {
        entries.push({
          id: `note:${row.id}`,
          kind: TimelineKind.NOTE,
          occurredAt: row.createdAt.toISOString(),
          title: 'Note du staff',
          description: row.body,
          actorLabel: row.author.displayName,
          payload: { pinned: row.pinned },
        });
      }
    }

    if (wanted.has(TimelineKind.ROLE)) {
      const rows = await this.prisma.memberRoleEvent.findMany({
        where: {
          guildId,
          userId,
          // Le bot filtre deja a l'ecriture, mais on refiltre a la lecture :
          // c'est ce qui rend le reglage retroactif et reversible, sur les
          // evenements enregistres avant que le role ne soit exclu.
          role: { trackHistory: true },
          ...(hasRange ? { occurredAt: range } : {}),
        },
        orderBy: { occurredAt: 'desc' },
        take: TIMELINE_SOURCE_LIMIT,
        include: { role: true },
      });

      for (const row of rows) {
        entries.push({
          id: `role:${row.id.toString()}`,
          kind: TimelineKind.ROLE,
          occurredAt: row.occurredAt.toISOString(),
          title:
            row.type === 'ADDED'
              ? `Role ajoute : ${row.role.name}`
              : `Role retire : ${row.role.name}`,
          description: null,
          actorLabel: null,
          payload: { roleId: row.roleId, type: row.type },
        });
      }
    }

    if (wanted.has(TimelineKind.IDENTITY)) {
      const rows = await this.prisma.identityEvent.findMany({
        where: { userId, ...(hasRange ? { occurredAt: range } : {}) },
        orderBy: { occurredAt: 'desc' },
        take: TIMELINE_SOURCE_LIMIT,
      });

      const labels: Record<string, string> = {
        USERNAME_CHANGED: 'Pseudo modifie',
        GLOBAL_NAME_CHANGED: 'Nom global modifie',
        NICKNAME_CHANGED: 'Surnom modifie',
        AVATAR_CHANGED: 'Avatar modifie',
      };

      for (const row of rows) {
        entries.push({
          id: `identity:${row.id.toString()}`,
          kind: TimelineKind.IDENTITY,
          occurredAt: row.occurredAt.toISOString(),
          title: labels[row.type] ?? 'Identite modifiee',
          description:
            row.oldValue || row.newValue
              ? `${row.oldValue ?? '(vide)'} -> ${row.newValue ?? '(vide)'}`
              : null,
          actorLabel: null,
          payload: { type: row.type },
        });
      }
    }

    if (wanted.has(TimelineKind.TICKET)) {
      const rows = await this.prisma.ticket.findMany({
        where: { guildId, openerId: userId, ...(hasRange ? { openedAt: range } : {}) },
        orderBy: { openedAt: 'desc' },
        take: TIMELINE_SOURCE_LIMIT,
      });

      for (const row of rows) {
        entries.push({
          id: `ticket:${row.id}`,
          kind: TimelineKind.TICKET,
          occurredAt: row.openedAt.toISOString(),
          title: `Ticket #${row.number} : ${row.subject}`,
          description: null,
          actorLabel: null,
          payload: { ticketId: row.id, status: row.status },
        });
      }
    }

    entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

    const page = entries.slice(query.skip, query.skip + query.take);
    return paginate(page, entries.length, query);
  }

  /**
   * Roles du serveur, pour alimenter les filtres du dashboard et l'ecran de
   * reglage. La liste reste complete : un role exclu de l'historique doit
   * rester filtrable et visible sur les fiches.
   */
  async listRoles(): Promise<RoleSummary[]> {
    const roles = await this.prisma.role.findMany({
      where: { guildId: this.guild.guildId, deletedAt: null },
      orderBy: { position: 'desc' },
    });
    return roles.map(toRoleSummary);
  }

  /**
   * Active ou desactive l'historisation d'un role.
   *
   * Le changement est retroactif : les evenements deja enregistres pour ce role
   * disparaissent des chronologies, et reapparaissent si on le reactive. Rien
   * n'est supprime en base, seule la lecture est filtree.
   */
  async setRoleTracking(
    roleId: string,
    trackHistory: boolean,
    actor: AuthenticatedUser,
  ): Promise<RoleSummary> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, guildId: this.guild.guildId },
    });

    if (!role) throw new NotFoundException('Role introuvable sur ce serveur.');

    const updated = await this.prisma.role.update({
      where: { id: roleId },
      data: { trackHistory },
    });

    await this.audit.record({
      appUserId: actor.id,
      action: 'role.tracking',
      entityType: 'role',
      entityId: roleId,
      before: { trackHistory: role.trackHistory },
      after: { trackHistory, name: role.name },
    });

    return toRoleSummary(updated);
  }
}
