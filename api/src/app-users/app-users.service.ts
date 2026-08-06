import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@anubis/shared/prisma';
import {
  ROLE_RANK,
  type AppUserDto,
  type CreateAppUserResponse,
  type Paginated,
  type ResetPasswordResponse,
} from '@anubis/shared';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { paginate } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AppUserQueryDto,
  CreateAppUserDto,
  UpdateAppUserDto,
} from './dto/app-user.dto';

const APP_USER_INCLUDE = {
  createdBy: { select: { displayName: true } },
} satisfies Prisma.AppUserInclude;

type AppUserRow = Prisma.AppUserGetPayload<{ include: typeof APP_USER_INCLUDE }>;

@Injectable()
export class AppUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
  ) {}

  private toDto(row: AppUserRow): AppUserDto {
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      role: row.role,
      isActive: row.isActive,
      mustChangePassword: row.mustChangePassword,
      discordUserId: row.discordUserId,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      lockedUntil: row.lockedUntil?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      createdByLabel: row.createdBy?.displayName ?? null,
    };
  }

  /**
   * Un compte ne peut agir que sur des rangs strictement inferieurs au sien.
   *
   * Sans cette regle, un administrateur pourrait se promouvoir proprietaire ou
   * desactiver le compte de quelqu'un de plus haut place — ce qui viderait la
   * hierarchie de son sens.
   */
  private assertCanManage(actor: AuthenticatedUser, targetRank: number): void {
    if (ROLE_RANK[actor.role] <= targetRank) {
      throw new ForbiddenException(
        'Vous ne pouvez pas gerer un compte de rang superieur ou egal au votre.',
      );
    }
  }

  private generatePassword(): string {
    return randomBytes(18).toString('base64url');
  }

  async search(query: AppUserQueryDto): Promise<Paginated<AppUserDto>> {
    const where: Prisma.AppUserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { username: { contains: query.search, mode: 'insensitive' } },
              { displayName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.appUser.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { username: 'asc' }],
        skip: query.skip,
        take: query.take,
        include: APP_USER_INCLUDE,
      }),
      this.prisma.appUser.count({ where }),
    ]);

    return paginate(rows.map((row) => this.toDto(row)), total, query);
  }

  async create(
    dto: CreateAppUserDto,
    actor: AuthenticatedUser,
  ): Promise<CreateAppUserResponse> {
    this.assertCanManage(actor, ROLE_RANK[dto.role]);

    const existing = await this.prisma.appUser.findUnique({
      where: { username: dto.username },
    });

    if (existing) {
      throw new ConflictException(
        `L identifiant "${dto.username}" est deja utilise.`,
      );
    }

    // Mot de passe genere par defaut : plus sur qu'un mot de passe choisi par
    // un tiers, et il force un changement a la premiere connexion.
    const generated = dto.password ? null : this.generatePassword();
    const password = dto.password ?? generated!;

    const created = await this.prisma.appUser.create({
      data: {
        username: dto.username,
        displayName: dto.displayName,
        role: dto.role,
        passwordHash: await AuthService.hashPassword(password),
        mustChangePassword: true,
        discordUserId: dto.discordUserId ?? null,
        createdById: actor.id,
      },
      include: APP_USER_INCLUDE,
    });

    await this.audit.record({
      appUserId: actor.id,
      action: 'appuser.create',
      entityType: 'app_user',
      entityId: created.id,
      after: { username: dto.username, role: dto.role },
    });

    return { user: this.toDto(created), generatedPassword: generated };
  }

  private async loadTarget(id: string): Promise<AppUserRow> {
    const row = await this.prisma.appUser.findUnique({
      where: { id },
      include: APP_USER_INCLUDE,
    });

    if (!row) throw new NotFoundException('Compte introuvable.');
    return row;
  }

  async update(
    id: string,
    dto: UpdateAppUserDto,
    actor: AuthenticatedUser,
  ): Promise<AppUserDto> {
    const target = await this.loadTarget(id);

    if (target.id !== actor.id) {
      this.assertCanManage(actor, ROLE_RANK[target.role]);
    }

    if (dto.role && dto.role !== target.role) {
      if (target.id === actor.id) {
        throw new ForbiddenException(
          'Vous ne pouvez pas modifier votre propre role.',
        );
      }
      this.assertCanManage(actor, ROLE_RANK[dto.role]);
    }

    if (dto.isActive === false) {
      if (target.id === actor.id) {
        throw new BadRequestException(
          'Vous ne pouvez pas desactiver votre propre compte.',
        );
      }
      await this.assertNotLastOwner(target);
    }

    const updated = await this.prisma.appUser.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined
          ? { displayName: dto.displayName }
          : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.discordUserId !== undefined
          ? { discordUserId: dto.discordUserId }
          : {}),
      },
      include: APP_USER_INCLUDE,
    });

    // Un compte desactive ou retrograde ne doit pas conserver une session
    // ouverte avec ses anciens droits.
    if (dto.isActive === false || (dto.role && dto.role !== target.role)) {
      await this.tokens.revokeAllForUser(id);
    }

    await this.audit.record({
      appUserId: actor.id,
      action: 'appuser.update',
      entityType: 'app_user',
      entityId: id,
      before: {
        role: target.role,
        isActive: target.isActive,
        displayName: target.displayName,
      },
      after: { ...dto },
    });

    return this.toDto(updated);
  }

  /** Empeche de se retrouver sans aucun proprietaire actif. */
  private async assertNotLastOwner(target: AppUserRow): Promise<void> {
    if (target.role !== 'OWNER') return;

    const remaining = await this.prisma.appUser.count({
      where: { role: 'OWNER', isActive: true, id: { not: target.id } },
    });

    if (remaining === 0) {
      throw new BadRequestException(
        'Impossible de desactiver le dernier compte proprietaire.',
      );
    }
  }

  async resetPassword(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<ResetPasswordResponse> {
    const target = await this.loadTarget(id);
    this.assertCanManage(actor, ROLE_RANK[target.role]);

    const password = this.generatePassword();

    await this.prisma.appUser.update({
      where: { id },
      data: {
        passwordHash: await AuthService.hashPassword(password),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    await this.tokens.revokeAllForUser(id);

    await this.audit.record({
      appUserId: actor.id,
      action: 'appuser.reset_password',
      entityType: 'app_user',
      entityId: id,
    });

    return { generatedPassword: password };
  }

  /** Leve un verrouillage sans changer le mot de passe. */
  async unlock(id: string, actor: AuthenticatedUser): Promise<AppUserDto> {
    const target = await this.loadTarget(id);
    this.assertCanManage(actor, ROLE_RANK[target.role]);

    const updated = await this.prisma.appUser.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null },
      include: APP_USER_INCLUDE,
    });

    await this.audit.record({
      appUserId: actor.id,
      action: 'appuser.unlock',
      entityType: 'app_user',
      entityId: id,
    });

    return this.toDto(updated);
  }
}
