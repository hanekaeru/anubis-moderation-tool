import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@anubis/shared/prisma";
import {
	DEFAULT_EMBED_COLOR,
	EMBED_TOTAL_LIMIT,
	EmbedMessageStatus,
	embedCharacterCount,
	hasEmbedContent,
	type EmbedFieldDto,
	type EmbedMessageDto,
	type Paginated,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { paginate } from "../common/dto/pagination.dto";
import { GuildContextService } from "../common/guild-context.service";
import { toActorRef } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type {
	CreateEmbedMessageDto,
	EmbedMessageQueryDto,
	UpdateEmbedMessageDto,
} from "./dto/embed.dto";

const EMBED_INCLUDE = {
	createdBy: true,
} satisfies Prisma.EmbedMessageInclude;

type EmbedRow = Prisma.EmbedMessageGetPayload<{ include: typeof EMBED_INCLUDE }>;

/**
 * Messages composes depuis le dashboard.
 *
 * **L'API ne parle jamais a Discord.** Elle enregistre la ligne, laisse
 * `discordSyncedAt` a `null` et passe le statut a `QUEUED` ; le bot repasse
 * toutes les cinq secondes, publie ou corrige le message, puis pose l'horodatage.
 * C'est le meme patron que les concours et les sanctions posees depuis la
 * webapp : seul le process bot detient une connexion a la passerelle.
 */
@Injectable()
export class EmbedsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	/**
	 * Les champs sont stockes en JSON : Prisma les rend en `JsonValue`, dont
	 * rien ne garantit la forme au typage. La relecture est donc defensive —
	 * une ligne ecrite avant un changement de contrat ne doit pas faire tomber
	 * la liste entiere.
	 */
	private static readFields(value: Prisma.JsonValue): EmbedFieldDto[] {
		if (!Array.isArray(value)) return [];

		return value.flatMap((entry) => {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];

			const record = entry as Record<string, unknown>;
			if (typeof record.name !== "string" || typeof record.value !== "string") {
				return [];
			}

			return [
				{
					name: record.name,
					value: record.value,
					inline: record.inline === true,
				},
			];
		});
	}

	private toDto(row: EmbedRow): EmbedMessageDto {
		return {
			id: row.id,
			guildId: row.guildId,
			channelId: row.channelId,
			messageId: row.messageId,
			name: row.name,
			content: row.content,
			title: row.title,
			description: row.description,
			color: row.color,
			url: row.url,
			authorName: row.authorName,
			authorIconUrl: row.authorIconUrl,
			thumbnailUrl: row.thumbnailUrl,
			imageUrl: row.imageUrl,
			footerText: row.footerText,
			footerIconUrl: row.footerIconUrl,
			fields: EmbedsService.readFields(row.fields),
			showTimestamp: row.showTimestamp,
			status: row.status,
			lastError: row.lastError,
			createdBy: toActorRef(null, row.createdBy),
			discordSyncedAt: row.discordSyncedAt?.toISOString() ?? null,
			sentAt: row.sentAt?.toISOString() ?? null,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	/**
	 * Refuse ce que Discord refuserait.
	 *
	 * Les limites par champ sont deja portees par les DTO ; ce qui se verifie
	 * ici ne se voit qu'en regardant l'embed entier — un contenu visible, et le
	 * total de 6000 caracteres que Discord applique tous champs confondus. Sans
	 * ce controle, l'echec n'apparaitrait qu'a la publication, cote bot, sur un
	 * message deja mis en file.
	 */
	private assertSendable(embed: {
		title?: string | null;
		description?: string | null;
		footerText?: string | null;
		authorName?: string | null;
		imageUrl?: string | null;
		thumbnailUrl?: string | null;
		fields?: EmbedFieldDto[];
		content?: string | null;
	}): void {
		if (!hasEmbedContent(embed) && !embed.content) {
			throw new BadRequestException(
				"Un message vide ne peut pas être envoyé : renseignez au moins un titre, une description, une image ou un champ.",
			);
		}

		const total = embedCharacterCount(embed);
		if (total > EMBED_TOTAL_LIMIT) {
			throw new BadRequestException(
				`L'embed dépasse la limite de Discord : ${total} caractères pour ${EMBED_TOTAL_LIMIT} autorisés.`,
			);
		}
	}

	async list(query: EmbedMessageQueryDto): Promise<Paginated<EmbedMessageDto>> {
		const where: Prisma.EmbedMessageWhereInput = {
			guildId: this.guild.guildId,
			...(query.status ? { status: query.status } : {}),
		};

		const [rows, total] = await Promise.all([
			this.prisma.embedMessage.findMany({
				where,
				orderBy: { updatedAt: "desc" },
				skip: query.skip,
				take: query.take,
				include: EMBED_INCLUDE,
			}),
			this.prisma.embedMessage.count({ where }),
		]);

		return paginate(
			rows.map((row) => this.toDto(row)),
			total,
			query,
		);
	}

	async findOne(id: string): Promise<EmbedMessageDto> {
		return this.toDto(await this.loadRow(id));
	}

	private async loadRow(id: string): Promise<EmbedRow> {
		const row = await this.prisma.embedMessage.findFirst({
			where: { id, guildId: this.guild.guildId },
			include: EMBED_INCLUDE,
		});

		if (!row) throw new NotFoundException("Message introuvable.");
		return row;
	}

	/**
	 * Enregistre un brouillon.
	 *
	 * Rien n'est envoye : la creation et l'envoi sont deux gestes distincts,
	 * pour qu'un message destine a tout le serveur puisse etre relu avant de
	 * partir.
	 */
	async create(
		dto: CreateEmbedMessageDto,
		actor: AuthenticatedUser,
	): Promise<EmbedMessageDto> {
		const saved = await this.prisma.embedMessage.create({
			data: {
				guildId: this.guild.guildId,
				channelId: dto.channelId,
				name: dto.name,
				content: dto.content ?? null,
				title: dto.title ?? null,
				description: dto.description ?? null,
				color: dto.color ?? DEFAULT_EMBED_COLOR,
				url: dto.url ?? null,
				authorName: dto.authorName ?? null,
				authorIconUrl: dto.authorIconUrl ?? null,
				thumbnailUrl: dto.thumbnailUrl ?? null,
				imageUrl: dto.imageUrl ?? null,
				footerText: dto.footerText ?? null,
				footerIconUrl: dto.footerIconUrl ?? null,
				fields: EmbedsService.toJsonFields(this.normalizeFields(dto.fields)),
				showTimestamp: dto.showTimestamp ?? false,
				status: EmbedMessageStatus.DRAFT,
				createdById: actor.id,
			},
			include: EMBED_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "embed.create",
			entityType: "embed_message",
			entityId: saved.id,
			after: { name: saved.name, channelId: saved.channelId },
		});

		return this.toDto(saved);
	}

	/** `inline` prend sa valeur par defaut ici, pour que la base ne stocke pas d'implicite. */
	private normalizeFields(
		fields: { name: string; value: string; inline?: boolean }[] | undefined,
	): EmbedFieldDto[] {
		return (fields ?? []).map((field) => ({
			name: field.name,
			value: field.value,
			inline: field.inline ?? false,
		}));
	}

	/**
	 * Forme acceptee par la colonne JSON.
	 *
	 * `InputJsonValue` n'admet pas un tableau d'interfaces : une interface n'a
	 * pas de signature d'index, quand bien meme sa forme est du JSON valide.
	 * La conversion est donc explicite, sur des donnees deja normalisees par
	 * `normalizeFields`.
	 */
	private static toJsonFields(fields: EmbedFieldDto[]): Prisma.InputJsonValue {
		return fields as unknown as Prisma.InputJsonValue;
	}

	/**
	 * Modifie un message.
	 *
	 * Un message deja publie repasse en `QUEUED` avec `discordSyncedAt` a
	 * `null` : le bot ira corriger l'existant, qu'il retrouve par `messageId`.
	 * Un brouillon reste un brouillon — modifier n'est pas envoyer.
	 */
	async update(
		id: string,
		dto: UpdateEmbedMessageDto,
		actor: AuthenticatedUser,
	): Promise<EmbedMessageDto> {
		const existing = await this.loadRow(id);

		const merged = {
			title: dto.title !== undefined ? dto.title : existing.title,
			description:
				dto.description !== undefined ? dto.description : existing.description,
			footerText: dto.footerText !== undefined ? dto.footerText : existing.footerText,
			authorName: dto.authorName !== undefined ? dto.authorName : existing.authorName,
			imageUrl: dto.imageUrl !== undefined ? dto.imageUrl : existing.imageUrl,
			thumbnailUrl:
				dto.thumbnailUrl !== undefined ? dto.thumbnailUrl : existing.thumbnailUrl,
			content: dto.content !== undefined ? dto.content : existing.content,
			fields: dto.fields
				? this.normalizeFields(dto.fields)
				: EmbedsService.readFields(existing.fields),
		};

		// Un message deja parti doit rester envoyable apres correction : le
		// laisser devenir invalide condamnerait le bot a echouer en boucle.
		if (existing.status !== EmbedMessageStatus.DRAFT) {
			this.assertSendable(merged);
		}

		const saved = await this.prisma.embedMessage.update({
			where: { id },
			data: {
				...(dto.name !== undefined ? { name: dto.name } : {}),
				...(dto.content !== undefined ? { content: dto.content } : {}),
				...(dto.title !== undefined ? { title: dto.title } : {}),
				...(dto.description !== undefined ? { description: dto.description } : {}),
				...(dto.color !== undefined ? { color: dto.color } : {}),
				...(dto.url !== undefined ? { url: dto.url } : {}),
				...(dto.authorName !== undefined ? { authorName: dto.authorName } : {}),
				...(dto.authorIconUrl !== undefined
					? { authorIconUrl: dto.authorIconUrl }
					: {}),
				...(dto.thumbnailUrl !== undefined ? { thumbnailUrl: dto.thumbnailUrl } : {}),
				...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
				...(dto.footerText !== undefined ? { footerText: dto.footerText } : {}),
				...(dto.footerIconUrl !== undefined
					? { footerIconUrl: dto.footerIconUrl }
					: {}),
				...(dto.fields !== undefined
					? {
							fields: EmbedsService.toJsonFields(
								this.normalizeFields(dto.fields),
							),
						}
					: {}),
				...(dto.showTimestamp !== undefined
					? { showTimestamp: dto.showTimestamp }
					: {}),
				// Deja publie : le message affiche ne reflete plus la ligne, le bot
				// doit repasser. Un brouillon, lui, n'a rien a rattraper.
				...(existing.status === EmbedMessageStatus.DRAFT
					? {}
					: { status: EmbedMessageStatus.QUEUED, discordSyncedAt: null, lastError: null }),
			},
			include: EMBED_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "embed.update",
			entityType: "embed_message",
			entityId: saved.id,
			before: { name: existing.name, status: existing.status },
			after: { name: saved.name, status: saved.status },
		});

		return this.toDto(saved);
	}

	/**
	 * Met le message en file d'envoi.
	 *
	 * Un message deja envoye peut etre remis en file : c'est ce qui republie
	 * une annonce corrigee dont l'edition a echoue, ou dont le message d'origine
	 * a ete supprime sur Discord. L'identifiant du message n'est pas efface —
	 * le bot tente d'abord de corriger l'existant, et ne publie a nouveau que
	 * s'il ne le retrouve pas.
	 */
	async send(id: string, actor: AuthenticatedUser): Promise<EmbedMessageDto> {
		const existing = await this.loadRow(id);

		if (existing.status === EmbedMessageStatus.QUEUED) {
			throw new BadRequestException("Ce message est déjà en attente d'envoi.");
		}

		this.assertSendable({
			title: existing.title,
			description: existing.description,
			footerText: existing.footerText,
			authorName: existing.authorName,
			imageUrl: existing.imageUrl,
			thumbnailUrl: existing.thumbnailUrl,
			content: existing.content,
			fields: EmbedsService.readFields(existing.fields),
		});

		const saved = await this.prisma.embedMessage.update({
			where: { id },
			data: {
				status: EmbedMessageStatus.QUEUED,
				discordSyncedAt: null,
				lastError: null,
			},
			include: EMBED_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "embed.send",
			entityType: "embed_message",
			entityId: saved.id,
			after: { channelId: saved.channelId, name: saved.name },
		});

		return this.toDto(saved);
	}

	/**
	 * Supprime la ligne.
	 *
	 * Le message publie sur Discord n'est **pas** retire : ce qui a ete dit au
	 * serveur a ete lu, et l'effacer d'un clic depuis le dashboard serait une
	 * action bien plus lourde que « ranger sa liste ». Retirer le message se
	 * fait dans Discord.
	 */
	async remove(id: string, actor: AuthenticatedUser): Promise<void> {
		const existing = await this.loadRow(id);

		await this.prisma.embedMessage.delete({ where: { id } });

		await this.audit.record({
			appUserId: actor.id,
			action: "embed.delete",
			entityType: "embed_message",
			entityId: id,
			before: { name: existing.name, status: existing.status },
		});
	}
}
