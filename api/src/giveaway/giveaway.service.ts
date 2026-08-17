import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@anubis/shared/prisma";
import {
	DEFAULT_GIVEAWAY_EMOJI,
	GiveawayStatus,
	type GiveawayDto,
	type GiveawayEntryDto,
	type Paginated,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { paginate } from "../common/dto/pagination.dto";
import { GuildContextService } from "../common/guild-context.service";
import { toActorRef, toMemberRef, type DiscordUserLike } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type {
	CreateGiveawayDto,
	GiveawayQueryDto,
	UpdateGiveawayDto,
} from "./dto/giveaway.dto";

/**
 * Concours a participation par reaction.
 *
 * **L'API ne parle jamais a Discord.** Elle ecrit la ligne et laisse
 * `discordSyncedAt` a `null` ; le bot repasse et applique l'effet reel
 * (publication de l'embed, pose de la reaction, tirage, annonce). C'est le meme
 * patron que les sanctions posees depuis la webapp, et pour la meme raison :
 * seul le process bot detient une connexion a la passerelle.
 */
@Injectable()
export class GiveawayService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	/**
	 * Relations chargees pour construire un DTO complet.
	 *
	 * Les participations sont comptees, jamais listees en entier : un concours
	 * populaire en compte des milliers, et la liste ne sert qu'aux gagnants.
	 */
	private static readonly INCLUDE = {
		createdBy: true,
		entries: { where: { isWinner: true }, include: { user: true } },
		_count: { select: { entries: true } },
	} satisfies Prisma.GiveawayInclude;

	private toDto(
		row: Prisma.GiveawayGetPayload<{ include: typeof GiveawayService.INCLUDE }>,
		createdByDiscord: DiscordUserLike | null,
	): GiveawayDto {
		return {
			id: row.id,
			guildId: row.guildId,
			channelId: row.channelId,
			messageId: row.messageId,
			title: row.title,
			description: row.description,
			prize: row.prize,
			imageUrl: row.imageUrl,
			reactionEmoji: row.reactionEmoji,
			winnerCount: row.winnerCount,
			announceChannelId: row.announceChannelId,
			status: row.status,
			endsAt: row.endsAt.toISOString(),
			createdBy: toActorRef(createdByDiscord, row.createdBy),
			entryCount: row._count.entries,
			winners: row.entries.map((entry) => toMemberRef(entry.user)),
			discordSyncedAt: row.discordSyncedAt?.toISOString() ?? null,
			endedAt: row.endedAt?.toISOString() ?? null,
			createdAt: row.createdAt.toISOString(),
		};
	}

	/**
	 * Les auteurs Discord sont resolus en un seul appel plutot qu'un par ligne.
	 *
	 * `createdByDiscordId` ne porte pas de cle etrangere (un concours cree par
	 * `/giveaway` peut precéder l'enregistrement du compte au referentiel), donc
	 * Prisma ne peut pas le joindre : la resolution est faite ici, a la main.
	 */
	private async resolveDiscordAuthors(
		discordIds: (string | null)[],
	): Promise<Map<string, DiscordUserLike>> {
		const ids = [...new Set(discordIds.filter((id): id is string => Boolean(id)))];
		if (!ids.length) return new Map();

		const users = await this.prisma.discordUser.findMany({ where: { id: { in: ids } } });
		return new Map(users.map((user) => [user.id, user]));
	}

	async list(query: GiveawayQueryDto): Promise<Paginated<GiveawayDto>> {
		const where: Prisma.GiveawayWhereInput = {
			guildId: this.guild.guildId,
			...(query.status ? { status: query.status } : {}),
		};

		const [rows, total] = await Promise.all([
			this.prisma.giveaway.findMany({
				where,
				orderBy: { createdAt: "desc" },
				skip: query.skip,
				take: query.take,
				include: GiveawayService.INCLUDE,
			}),
			this.prisma.giveaway.count({ where }),
		]);

		const authors = await this.resolveDiscordAuthors(rows.map((row) => row.createdByDiscordId));
		const items = rows.map((row) =>
			this.toDto(row, row.createdByDiscordId ? (authors.get(row.createdByDiscordId) ?? null) : null),
		);

		return paginate(items, total, query);
	}

	async findOne(id: string): Promise<GiveawayDto> {
		const row = await this.prisma.giveaway.findFirst({
			where: { id, guildId: this.guild.guildId },
			include: GiveawayService.INCLUDE,
		});
		if (!row) throw new NotFoundException("Concours introuvable.");

		const authors = await this.resolveDiscordAuthors([row.createdByDiscordId]);
		return this.toDto(row, row.createdByDiscordId ? (authors.get(row.createdByDiscordId) ?? null) : null);
	}

	/** Participations d'un concours, gagnants d'abord puis par ordre d'arrivee. */
	async listEntries(id: string): Promise<GiveawayEntryDto[]> {
		// Verifie l'appartenance au serveur avant de lire les participations :
		// l'identifiant vient du client et ne prouve rien.
		await this.findOne(id);

		const rows = await this.prisma.giveawayEntry.findMany({
			where: { giveawayId: id },
			orderBy: [{ isWinner: "desc" }, { enteredAt: "asc" }],
			include: { user: true },
		});

		return rows.map((row) => ({
			member: toMemberRef(row.user),
			isWinner: row.isWinner,
			enteredAt: row.enteredAt.toISOString(),
		}));
	}

	async create(dto: CreateGiveawayDto, actor: AuthenticatedUser): Promise<GiveawayDto> {
		const saved = await this.prisma.giveaway.create({
			data: {
				guildId: this.guild.guildId,
				channelId: dto.channelId,
				title: dto.title,
				description: dto.description ?? null,
				prize: dto.prize,
				imageUrl: dto.imageUrl ?? null,
				reactionEmoji: dto.reactionEmoji ?? DEFAULT_GIVEAWAY_EMOJI,
				winnerCount: dto.winnerCount ?? 1,
				announceChannelId: dto.announceChannelId ?? null,
				endsAt: new Date(Date.now() + dto.durationMinutes * 60_000),
				createdById: actor.id,
				// Laisse a `null` : c'est ce qui met le concours dans la file de
				// publication du bot.
				discordSyncedAt: null,
			},
			include: GiveawayService.INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "giveaway.create",
			entityType: "giveaway",
			entityId: saved.id,
			after: { title: saved.title, prize: saved.prize, endsAt: saved.endsAt.toISOString() },
		});

		return this.toDto(saved, null);
	}

	async update(
		id: string,
		dto: UpdateGiveawayDto,
		actor: AuthenticatedUser,
	): Promise<GiveawayDto> {
		const existing = await this.prisma.giveaway.findFirst({
			where: { id, guildId: this.guild.guildId },
		});
		if (!existing) throw new NotFoundException("Concours introuvable.");

		// Un tirage deja annonce ne se remanie pas : changer le lot ou la duree
		// apres coup reecrirait l'histoire d'un concours que le serveur a vu se
		// derouler.
		if (existing.status === GiveawayStatus.ENDED || existing.status === GiveawayStatus.CANCELLED) {
			throw new BadRequestException("Un concours terminé ou annulé ne peut plus être modifié.");
		}

		const saved = await this.prisma.giveaway.update({
			where: { id },
			data: {
				...(dto.title !== undefined ? { title: dto.title } : {}),
				...(dto.description !== undefined ? { description: dto.description } : {}),
				...(dto.prize !== undefined ? { prize: dto.prize } : {}),
				...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
				...(dto.reactionEmoji !== undefined ? { reactionEmoji: dto.reactionEmoji } : {}),
				...(dto.winnerCount !== undefined ? { winnerCount: dto.winnerCount } : {}),
				...(dto.announceChannelId !== undefined
					? { announceChannelId: dto.announceChannelId }
					: {}),
				...(dto.durationMinutes !== undefined
					? { endsAt: new Date(Date.now() + dto.durationMinutes * 60_000) }
					: {}),
				// Remis a `null` a chaque ecriture web : l'embed publie ne reflete
				// plus la ligne, le bot doit repasser le corriger.
				discordSyncedAt: null,
			},
			include: GiveawayService.INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "giveaway.update",
			entityType: "giveaway",
			entityId: saved.id,
			before: { title: existing.title, prize: existing.prize, endsAt: existing.endsAt.toISOString() },
			after: { title: saved.title, prize: saved.prize, endsAt: saved.endsAt.toISOString() },
		});

		return this.toDto(saved, null);
	}

	async cancel(id: string, actor: AuthenticatedUser): Promise<GiveawayDto> {
		const existing = await this.prisma.giveaway.findFirst({
			where: { id, guildId: this.guild.guildId },
		});
		if (!existing) throw new NotFoundException("Concours introuvable.");

		if (existing.status === GiveawayStatus.ENDED) {
			throw new BadRequestException("Le tirage a déjà eu lieu : le concours ne peut plus être annulé.");
		}
		if (existing.status === GiveawayStatus.CANCELLED) {
			throw new BadRequestException("Ce concours est déjà annulé.");
		}

		const saved = await this.prisma.giveaway.update({
			where: { id },
			data: { status: GiveawayStatus.CANCELLED, discordSyncedAt: null },
			include: GiveawayService.INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "giveaway.cancel",
			entityType: "giveaway",
			entityId: saved.id,
			before: { status: existing.status },
			after: { status: saved.status },
		});

		return this.toDto(saved, null);
	}

	/**
	 * Nouveau tirage sur un concours deja termine.
	 *
	 * Les participations sont conservees : seuls les gagnants sont effaces, et
	 * `discordSyncedAt` repasse a `null` pour que le bot retire au sort parmi
	 * les memes participants puis annonce le resultat.
	 */
	async reroll(id: string, actor: AuthenticatedUser): Promise<GiveawayDto> {
		const existing = await this.prisma.giveaway.findFirst({
			where: { id, guildId: this.guild.guildId },
			include: { _count: { select: { entries: true } } },
		});
		if (!existing) throw new NotFoundException("Concours introuvable.");

		if (existing.status !== GiveawayStatus.ENDED) {
			throw new BadRequestException("Seul un concours terminé peut être retiré au sort.");
		}
		if (existing._count.entries === 0) {
			throw new BadRequestException("Aucune participation : il n'y a rien à tirer.");
		}

		const saved = await this.prisma.$transaction(async (tx) => {
			await tx.giveawayEntry.updateMany({
				where: { giveawayId: id, isWinner: true },
				data: { isWinner: false },
			});

			return tx.giveaway.update({
				where: { id },
				data: { discordSyncedAt: null, endedAt: null },
				include: GiveawayService.INCLUDE,
			});
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "giveaway.reroll",
			entityType: "giveaway",
			entityId: saved.id,
		});

		return this.toDto(saved, null);
	}
}
