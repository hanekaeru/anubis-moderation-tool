import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@anubis/shared/prisma";
import type {
	WikiArticleDto,
	WikiArticleSummaryDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import { toActorRef } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type {
	CreateWikiArticleDto,
	UpdateWikiArticleDto,
	WikiQueryDto,
} from "./dto/wiki.dto";
import {
	extractPlainText,
	isBlankContent,
	readingMinutes,
	sanitizeArticleHtml,
	slugify,
} from "./wiki-content";

const ARTICLE_INCLUDE = {
	createdBy: true,
	updatedBy: true,
} satisfies Prisma.WikiArticleInclude;

type ArticleRow = Prisma.WikiArticleGetPayload<{
	include: typeof ARTICLE_INCLUDE;
}>;

/**
 * Wiki interne de l'equipe de moderation.
 *
 * Le corps des articles est **toujours** nettoye ici avant l'ecriture, et
 * jamais accepte tel quel : voir `wiki-content.ts` pour le detail du risque.
 * Aucune autre voie n'ecrit dans `wiki_articles`.
 */
@Injectable()
export class WikiService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	private get guildId(): string {
		return this.guild.guildId;
	}

	async search(query: WikiQueryDto): Promise<WikiArticleSummaryDto[]> {
		const terme = query.q?.trim();

		const rows = await this.prisma.wikiArticle.findMany({
			where: {
				guildId: this.guildId,
				deletedAt: query.deleted ? { not: null } : null,
				...(query.category ? { category: query.category } : {}),
				// La recherche porte sur `contentText`, pas sur `contentHtml` :
				// chercher « strong » ne doit pas remonter tout article contenant
				// du gras.
				...(terme
					? {
							OR: [
								{ title: { contains: terme, mode: "insensitive" } },
								{ summary: { contains: terme, mode: "insensitive" } },
								{ contentText: { contains: terme, mode: "insensitive" } },
							],
						}
					: {}),
			},
			// Les epingles d'abord, puis le plus recemment touche : un article
			// mis a jour est celui qui vient de changer, donc celui qu'on cherche.
			orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
			include: ARTICLE_INCLUDE,
		});

		return rows.map((row) => this.toSummary(row));
	}

	async findBySlug(slug: string): Promise<WikiArticleDto> {
		const article = await this.prisma.wikiArticle.findFirst({
			where: { guildId: this.guildId, slug, deletedAt: null },
			include: ARTICLE_INCLUDE,
		});

		if (!article) throw new NotFoundException("Article introuvable.");

		return this.toDto(article);
	}

	async create(
		dto: CreateWikiArticleDto,
		actor: AuthenticatedUser,
	): Promise<WikiArticleDto> {
		const contentHtml = sanitizeArticleHtml(dto.contentHtml);

		// Le controle porte sur le HTML **nettoye** : un corps entierement
		// compose de balises refusees arrive non vide et repart vide.
		if (isBlankContent(contentHtml)) {
			throw new BadRequestException("Le contenu de l'article est vide.");
		}

		const slug = await this.slugLibre(slugify(dto.title));

		const created = await this.prisma.wikiArticle.create({
			data: {
				guildId: this.guildId,
				slug,
				title: dto.title.trim(),
				category: dto.category,
				summary: dto.summary?.trim() || null,
				contentHtml,
				contentText: extractPlainText(contentHtml),
				pinned: dto.pinned ?? false,
				createdById: actor.id,
				updatedById: actor.id,
			},
			include: ARTICLE_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "wiki.create",
			entityType: "wiki",
			entityId: created.id,
			after: { slug: created.slug, title: created.title, category: created.category },
		});

		return this.toDto(created);
	}

	async update(
		id: string,
		dto: UpdateWikiArticleDto,
		actor: AuthenticatedUser,
	): Promise<WikiArticleDto> {
		const existant = await this.garantirArticle(id);

		const data: Prisma.WikiArticleUpdateInput = { updatedBy: { connect: { id: actor.id } } };

		if (dto.title !== undefined) {
			data.title = dto.title.trim();
			// Le slug ne suit pas le titre : il vit dans les URL que l'equipe se
			// partage, et le renommer casserait chaque lien deja envoye. Un
			// article qui change de nom garde donc son adresse.
		}

		if (dto.category !== undefined) data.category = dto.category;
		if (dto.summary !== undefined) data.summary = dto.summary?.trim() || null;
		if (dto.pinned !== undefined) data.pinned = dto.pinned;

		if (dto.contentHtml !== undefined) {
			const contentHtml = sanitizeArticleHtml(dto.contentHtml);
			if (isBlankContent(contentHtml)) {
				throw new BadRequestException("Le contenu de l'article est vide.");
			}
			data.contentHtml = contentHtml;
			data.contentText = extractPlainText(contentHtml);
		}

		const updated = await this.prisma.wikiArticle.update({
			where: { id: existant.id },
			data,
			include: ARTICLE_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "wiki.update",
			entityType: "wiki",
			entityId: updated.id,
			before: {
				title: existant.title,
				category: existant.category,
				pinned: existant.pinned,
			},
			after: {
				title: updated.title,
				category: updated.category,
				pinned: updated.pinned,
			},
		});

		return this.toDto(updated);
	}

	/**
	 * Suppression logique.
	 *
	 * Une procedure effacee par megarde se recupere (`restore`), et rien ne
	 * refere a l'article qui casserait — c'est la meme regle que pour les notes.
	 */
	async remove(id: string, actor: AuthenticatedUser): Promise<void> {
		const article = await this.garantirArticle(id);

		await this.prisma.wikiArticle.update({
			where: { id: article.id },
			data: { deletedAt: new Date(), updatedById: actor.id },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "wiki.delete",
			entityType: "wiki",
			entityId: article.id,
			before: { slug: article.slug, title: article.title },
		});
	}

	async restore(id: string, actor: AuthenticatedUser): Promise<WikiArticleDto> {
		const article = await this.prisma.wikiArticle.findFirst({
			where: { id, guildId: this.guildId },
		});

		if (!article) throw new NotFoundException("Article introuvable.");
		if (!article.deletedAt) {
			throw new BadRequestException("Cet article n'est pas supprimé.");
		}

		const restored = await this.prisma.wikiArticle.update({
			where: { id: article.id },
			data: { deletedAt: null, updatedById: actor.id },
			include: ARTICLE_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "wiki.restore",
			entityType: "wiki",
			entityId: restored.id,
			after: { slug: restored.slug, title: restored.title },
		});

		return this.toDto(restored);
	}

	/** Verifie l'appartenance au serveur avant toute ecriture. */
	private async garantirArticle(id: string) {
		const article = await this.prisma.wikiArticle.findFirst({
			where: { id, guildId: this.guildId, deletedAt: null },
		});

		if (!article) throw new NotFoundException("Article introuvable.");

		return article;
	}

	/**
	 * Rend le slug unique en le suffixant.
	 *
	 * Deux articles peuvent legitimement porter des titres proches
	 * (« Bannissement » et « Bannissement ? »), qui produisent le meme slug. La
	 * contrainte d'unicite en base est le dernier mot ; cette boucle evite
	 * simplement de la heurter.
	 */
	private async slugLibre(base: string): Promise<string> {
		for (let suffixe = 0; suffixe < 50; suffixe += 1) {
			const candidat = suffixe === 0 ? base : `${base}-${suffixe + 1}`;

			const pris = await this.prisma.wikiArticle.findFirst({
				where: { guildId: this.guildId, slug: candidat },
				select: { id: true },
			});

			if (!pris) return candidat;
		}

		throw new ConflictException(
			"Impossible de trouver une adresse libre pour ce titre.",
		);
	}

	private toDto(row: ArticleRow): WikiArticleDto {
		return {
			id: row.id,
			slug: row.slug,
			title: row.title,
			category: row.category,
			summary: row.summary,
			contentHtml: row.contentHtml,
			pinned: row.pinned,
			createdBy: row.createdBy ? toActorRef(null, row.createdBy) : null,
			updatedBy: row.updatedBy ? toActorRef(null, row.updatedBy) : null,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	private toSummary(row: ArticleRow): WikiArticleSummaryDto {
		return {
			id: row.id,
			slug: row.slug,
			title: row.title,
			category: row.category,
			summary: row.summary,
			pinned: row.pinned,
			updatedBy: row.updatedBy ? toActorRef(null, row.updatedBy) : null,
			updatedAt: row.updatedAt.toISOString(),
			readingMinutes: readingMinutes(row.contentText),
		};
	}
}
