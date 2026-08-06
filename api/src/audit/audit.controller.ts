import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import {
  AuditLogEntryDto,
  Paginated,
  Permission,
} from '@anubis/shared';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';

class AuditQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  appUserId?: string;

  @IsOptional()
  @IsString()
  action?: string;
}

@Controller('audit')
@RequirePermissions(Permission.AUDIT_READ)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query() query: AuditQueryDto,
  ): Promise<Paginated<AuditLogEntryDto>> {
    const where = {
      ...(query.appUserId ? { appUserId: query.appUserId } : {}),
      ...(query.action ? { action: { contains: query.action } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
        include: { appUser: { select: { displayName: true, username: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const items: AuditLogEntryDto[] = rows.map((row) => ({
      // BigInt : converti explicitement, JSON.stringify ne sait pas le serialiser.
      id: row.id.toString(),
      actorLabel: row.appUser
        ? `${row.appUser.displayName} (${row.appUser.username})`
        : null,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
    }));

    return paginate(items, total, query);
  }
}
