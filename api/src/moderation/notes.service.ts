import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@anubis/shared/prisma';
import { Permission, type NoteDto } from '@anubis/shared';
import { AuditService } from '../audit/audit.service';
import { GuildContextService } from '../common/guild-context.service';
import { toActorRef } from '../common/mappers';
import type { AuthenticatedUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateNoteDto, UpdateNoteDto } from './dto/moderation.dto';

const NOTE_INCLUDE = { author: true } satisfies Prisma.MemberNoteInclude;
type NoteRow = Prisma.MemberNoteGetPayload<{ include: typeof NOTE_INCLUDE }>;

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guild: GuildContextService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Une note appartient a son auteur. Les autres comptes la lisent mais ne la
   * modifient pas ; seul un droit explicite de suppression permet de passer
   * outre, pour retirer une note inappropriee.
   */
  private canEdit(row: NoteRow, actor: AuthenticatedUser): boolean {
    return (
      row.authorId === actor.id ||
      actor.permissions.includes(Permission.NOTES_DELETE)
    );
  }

  private toDto(row: NoteRow, actor: AuthenticatedUser): NoteDto {
    return {
      id: row.id,
      guildId: row.guildId,
      userId: row.userId,
      author: toActorRef(null, row.author),
      body: row.body,
      pinned: row.pinned,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      canEdit: this.canEdit(row, actor),
    };
  }

  /** Notes d'un membre, epinglees en tete puis de la plus recente a la plus ancienne. */
  async listForMember(
    userId: string,
    actor: AuthenticatedUser,
  ): Promise<NoteDto[]> {
    const rows = await this.prisma.memberNote.findMany({
      where: { guildId: this.guild.guildId, userId, deletedAt: null },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      include: NOTE_INCLUDE,
    });

    return rows.map((row) => this.toDto(row, actor));
  }

  async create(dto: CreateNoteDto, actor: AuthenticatedUser): Promise<NoteDto> {
    const guildId = this.guild.guildId;

    const member = await this.prisma.member.findUnique({
      where: { guildId_userId: { guildId, userId: dto.userId } },
    });

    if (!member) {
      throw new NotFoundException(
        `Membre ${dto.userId} inconnu sur ce serveur.`,
      );
    }

    const created = await this.prisma.memberNote.create({
      data: {
        guildId,
        userId: dto.userId,
        authorId: actor.id,
        body: dto.body,
        pinned: dto.pinned ?? false,
      },
      include: NOTE_INCLUDE,
    });

    await this.audit.record({
      appUserId: actor.id,
      action: 'note.create',
      entityType: 'note',
      entityId: created.id,
      after: { userId: dto.userId },
    });

    return this.toDto(created, actor);
  }

  private async loadOwned(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<NoteRow> {
    const row = await this.prisma.memberNote.findFirst({
      where: { id, guildId: this.guild.guildId, deletedAt: null },
      include: NOTE_INCLUDE,
    });

    if (!row) throw new NotFoundException('Note introuvable.');

    if (!this.canEdit(row, actor)) {
      throw new ForbiddenException(
        'Seul l auteur d une note peut la modifier.',
      );
    }

    return row;
  }

  async update(
    id: string,
    dto: UpdateNoteDto,
    actor: AuthenticatedUser,
  ): Promise<NoteDto> {
    const existing = await this.loadOwned(id, actor);

    const updated = await this.prisma.memberNote.update({
      where: { id },
      data: {
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
      },
      include: NOTE_INCLUDE,
    });

    await this.audit.record({
      appUserId: actor.id,
      action: 'note.update',
      entityType: 'note',
      entityId: id,
      before: { body: existing.body, pinned: existing.pinned },
      after: { body: updated.body, pinned: updated.pinned },
    });

    return this.toDto(updated, actor);
  }

  /**
   * Suppression logique : le contenu disparait de l'interface mais la ligne
   * reste, pour qu'une note effacee ne cree pas de trou inexplicable dans une
   * chronologie deja consultee.
   */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.loadOwned(id, actor);

    await this.prisma.memberNote.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      appUserId: actor.id,
      action: 'note.delete',
      entityType: 'note',
      entityId: id,
      before: { userId: existing.userId, body: existing.body },
    });
  }
}
