import { Type } from "class-transformer";
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	IsUrl,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
	ValidateNested,
} from "class-validator";
import { EMBED_LIMITS, EmbedMessageStatus } from "@anubis/shared";
import { PaginationDto } from "../../common/dto/pagination.dto";

const SNOWFLAKE = /^\d{17,20}$/;

/** Les URL sont posees telles quelles dans l'embed : le protocole est contraint. */
const URL_OPTIONS = { protocols: ["http", "https"], require_protocol: true };

export class EmbedFieldDto {
	@IsString()
	@MinLength(1)
	@MaxLength(EMBED_LIMITS.fieldName)
	name!: string;

	@IsString()
	@MinLength(1)
	@MaxLength(EMBED_LIMITS.fieldValue)
	value!: string;

	@IsOptional()
	@IsBoolean()
	inline?: boolean;
}

export class CreateEmbedMessageDto {
	@Matches(SNOWFLAKE)
	channelId!: string;

	@IsString()
	@MinLength(1)
	@MaxLength(EMBED_LIMITS.name)
	name!: string;

	@IsOptional()
	@IsString()
	@MaxLength(EMBED_LIMITS.content)
	content?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(EMBED_LIMITS.title)
	title?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(EMBED_LIMITS.description)
	description?: string | null;

	// Entier Discord 0xRRGGBB : au-dela de 0xFFFFFF, la couleur est refusee a
	// l'envoi, donc autant la refuser a la saisie.
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	@Max(0xffffff)
	color?: number;

	@IsOptional()
	@IsUrl(URL_OPTIONS)
	url?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(EMBED_LIMITS.authorName)
	authorName?: string | null;

	@IsOptional()
	@IsUrl(URL_OPTIONS)
	authorIconUrl?: string | null;

	@IsOptional()
	@IsUrl(URL_OPTIONS)
	thumbnailUrl?: string | null;

	@IsOptional()
	@IsUrl(URL_OPTIONS)
	imageUrl?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(EMBED_LIMITS.footerText)
	footerText?: string | null;

	@IsOptional()
	@IsUrl(URL_OPTIONS)
	footerIconUrl?: string | null;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(EMBED_LIMITS.fields)
	@ValidateNested({ each: true })
	@Type(() => EmbedFieldDto)
	fields?: EmbedFieldDto[];

	@IsOptional()
	@IsBoolean()
	showTimestamp?: boolean;
}

/**
 * Modification d'un message.
 *
 * `channelId` est absent : deplacer un message deja publie supposerait de le
 * supprimer et d'en republier un autre, donc de perdre reactions et epinglages.
 */
export class UpdateEmbedMessageDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(EMBED_LIMITS.name)
	name?: string;

	@IsOptional()
	@IsString()
	@MaxLength(EMBED_LIMITS.content)
	content?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(EMBED_LIMITS.title)
	title?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(EMBED_LIMITS.description)
	description?: string | null;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	@Max(0xffffff)
	color?: number;

	@IsOptional()
	@IsUrl(URL_OPTIONS)
	url?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(EMBED_LIMITS.authorName)
	authorName?: string | null;

	@IsOptional()
	@IsUrl(URL_OPTIONS)
	authorIconUrl?: string | null;

	@IsOptional()
	@IsUrl(URL_OPTIONS)
	thumbnailUrl?: string | null;

	@IsOptional()
	@IsUrl(URL_OPTIONS)
	imageUrl?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(EMBED_LIMITS.footerText)
	footerText?: string | null;

	@IsOptional()
	@IsUrl(URL_OPTIONS)
	footerIconUrl?: string | null;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(EMBED_LIMITS.fields)
	@ValidateNested({ each: true })
	@Type(() => EmbedFieldDto)
	fields?: EmbedFieldDto[];

	@IsOptional()
	@IsBoolean()
	showTimestamp?: boolean;
}

export class EmbedMessageQueryDto extends PaginationDto {
	@IsOptional()
	@IsIn(Object.values(EmbedMessageStatus))
	status?: EmbedMessageStatus;
}
