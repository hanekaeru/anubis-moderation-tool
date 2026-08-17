import {
	IsBoolean,
	IsIn,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
	ValidateIf,
} from "class-validator";
import {
	MAX_WIKI_CONTENT_LENGTH,
	MAX_WIKI_SUMMARY_LENGTH,
	MAX_WIKI_TITLE_LENGTH,
	WikiCategory,
} from "@anubis/shared";
import { ToBoolean } from "../../common/dto/pagination.dto";

export class CreateWikiArticleDto {
	@IsString()
	@MinLength(3, { message: "Le titre doit faire au moins 3 caractères." })
	@MaxLength(MAX_WIKI_TITLE_LENGTH)
	title!: string;

	@IsIn(Object.values(WikiCategory))
	category: WikiCategory = "OTHER";

	// `null` efface le resume sans le rendre obligatoire : meme convention que
	// les champs facultatifs de la quarantaine.
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(MAX_WIKI_SUMMARY_LENGTH)
	summary?: string | null;

	@IsString()
	@MaxLength(MAX_WIKI_CONTENT_LENGTH)
	contentHtml!: string;

	@IsOptional()
	@IsBoolean()
	pinned?: boolean;
}

export class UpdateWikiArticleDto {
	@IsOptional()
	@IsString()
	@MinLength(3, { message: "Le titre doit faire au moins 3 caractères." })
	@MaxLength(MAX_WIKI_TITLE_LENGTH)
	title?: string;

	@IsOptional()
	@IsIn(Object.values(WikiCategory))
	category?: WikiCategory;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(MAX_WIKI_SUMMARY_LENGTH)
	summary?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(MAX_WIKI_CONTENT_LENGTH)
	contentHtml?: string;

	@IsOptional()
	@IsBoolean()
	pinned?: boolean;
}

export class WikiQueryDto {
	@IsOptional()
	@IsString()
	@MaxLength(120)
	q?: string;

	@IsOptional()
	@IsIn(Object.values(WikiCategory))
	category?: WikiCategory;

	/** Inclure les articles supprimes ; reserve a la corbeille. */
	@IsOptional()
	@ToBoolean()
	@IsBoolean()
	deleted?: boolean;
}
