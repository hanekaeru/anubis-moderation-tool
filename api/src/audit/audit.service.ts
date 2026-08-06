import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@anubis/shared/prisma';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  appUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Journal des actions effectuees depuis le dashboard.
 *
 * L'ecriture ne doit jamais faire echouer l'action metier : si le journal
 * tombe, on log l'incident et on laisse passer. Perdre une ligne d'audit est
 * moins grave que refuser une sanction legitime.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          appUserId: entry.appUserId ?? null,
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          before: entry.before ?? undefined,
          after: entry.after ?? undefined,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 255) ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Ecriture du journal d audit impossible (action: ${entry.action})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
