import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigGuild } from '@anubis/shared/prisma';
import type { GuildConfigDto } from '@anubis/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/types';
import { GuildContextService } from '../common/guild-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateGuildConfigDto, UpdateGuildConfigDto } from './dto/guild-config.dto';

@Injectable()
export class GuildConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guild: GuildContextService,
    private readonly audit: AuditService,
  ) {}

  private toDto(row: ConfigGuild): GuildConfigDto {
    return {
      id: row.id.toString(),
      guildId: row.guildId,
      configName: row.configName,
      configValue: row.configValue,
      configDescription: row.configDescription,
    };
  }

  /** `id` vient de l'URL : une valeur qui n'est pas un entier n'existe pas. */
  private parseId(id: string): bigint {
    if (!/^\d+$/.test(id)) {
      throw new BadRequestException('Identifiant invalide.');
    }
    return BigInt(id);
  }

  async list(): Promise<GuildConfigDto[]> {
    const rows = await this.prisma.configGuild.findMany({
      where: { guildId: this.guild.guildId },
      orderBy: { configName: 'asc' },
    });

    return rows.map((row) => this.toDto(row));
  }

  async create(
    dto: CreateGuildConfigDto,
    actor: AuthenticatedUser,
  ): Promise<GuildConfigDto> {
    const guildId = this.guild.guildId;

    const existing = await this.prisma.configGuild.findUnique({
      where: { guildId_configName: { guildId, configName: dto.configName } },
    });

    if (existing) {
      throw new ConflictException(
        `Une configuration "${dto.configName}" existe deja pour ce serveur.`,
      );
    }

    const created = await this.prisma.configGuild.create({
      data: {
        guildId,
        configName: dto.configName,
        configValue: dto.configValue,
        configDescription: dto.configDescription,
      },
    });

    await this.audit.record({
      appUserId: actor.id,
      action: 'guildconfig.create',
      entityType: 'config_guild',
      entityId: created.id.toString(),
      after: { configName: dto.configName, configValue: dto.configValue },
    });

    return this.toDto(created);
  }

  private async loadTarget(id: bigint): Promise<ConfigGuild> {
    const row = await this.prisma.configGuild.findFirst({
      where: { id, guildId: this.guild.guildId },
    });

    if (!row) throw new NotFoundException('Configuration introuvable.');
    return row;
  }

  async update(
    id: string,
    dto: UpdateGuildConfigDto,
    actor: AuthenticatedUser,
  ): Promise<GuildConfigDto> {
    const target = await this.loadTarget(this.parseId(id));

    const updated = await this.prisma.configGuild.update({
      where: { id: target.id },
      data: {
        ...(dto.configValue !== undefined ? { configValue: dto.configValue } : {}),
        ...(dto.configDescription !== undefined
          ? { configDescription: dto.configDescription }
          : {}),
      },
    });

    await this.audit.record({
      appUserId: actor.id,
      action: 'guildconfig.update',
      entityType: 'config_guild',
      entityId: target.id.toString(),
      before: { configValue: target.configValue },
      after: { ...dto },
    });

    return this.toDto(updated);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const target = await this.loadTarget(this.parseId(id));

    await this.prisma.configGuild.delete({ where: { id: target.id } });

    await this.audit.record({
      appUserId: actor.id,
      action: 'guildconfig.delete',
      entityType: 'config_guild',
      entityId: target.id.toString(),
      before: { configName: target.configName, configValue: target.configValue },
    });
  }
}
