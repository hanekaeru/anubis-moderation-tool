import { WikiCategory } from "../enums";
import { IsoDateString } from "./common";
import { ActorRef } from "./moderation";

/**
 * Longueur maximale du corps d'un article, en caracteres de HTML.
 *
 * Genereuse a dessein : une procedure detaillee tient largement dedans. Elle
 * n'est la que pour borner ce qu'un editeur peut envoyer d'un coup — un collage
 * depuis un traitement de texte produit vite des dizaines de milliers de
 * caracteres de balisage pour trois paragraphes utiles.
 */
export const MAX_WIKI_CONTENT_LENGTH = 200_000;

export const MAX_WIKI_TITLE_LENGTH = 160;
export const MAX_WIKI_SUMMARY_LENGTH = 300;

/** Article complet, corps compris. */
export interface WikiArticleDto {
	id: string;
	slug: string;
	title: string;
	category: WikiCategory;
	summary: string | null;
	/** HTML deja nettoye par l'API ; le dashboard le repasse au sanitizer. */
	contentHtml: string;
	pinned: boolean;
	createdBy: ActorRef | null;
	updatedBy: ActorRef | null;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

/**
 * Entree de liste : tout sauf le corps.
 *
 * La liste affiche des dizaines d'articles ; embarquer chaque corps ferait
 * transiter des centaines de kilo-octets de HTML pour n'en rendre aucun.
 */
export interface WikiArticleSummaryDto {
	id: string;
	slug: string;
	title: string;
	category: WikiCategory;
	summary: string | null;
	pinned: boolean;
	updatedBy: ActorRef | null;
	updatedAt: IsoDateString;
	/** Temps de lecture estime, en minutes, calcule sur le texte nu. */
	readingMinutes: number;
}

export interface WikiSearchQuery {
	/** Recherche plein texte sur le titre, le resume et le corps sans balises. */
	q?: string;
	category?: WikiCategory;
}

export interface CreateWikiArticleRequest {
	title: string;
	category: WikiCategory;
	summary?: string | null;
	contentHtml: string;
	pinned?: boolean;
}

/** Modification partielle : seuls les champs presents sont ecrits. */
export interface UpdateWikiArticleRequest {
	title?: string;
	category?: WikiCategory;
	summary?: string | null;
	contentHtml?: string;
	pinned?: boolean;
}
