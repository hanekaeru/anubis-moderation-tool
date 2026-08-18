import {
	IsBoolean,
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
	ValidateIf,
} from "class-validator";
import { MAX_VOICE_STATUS_LENGTH, VoicePlacementMode } from "@anubis/shared";

/**
 * Le gabarit doit contenir `{index}` : sans lui, tous les salons d'un meme
 * salon de creation porteraient le meme nom et deviendraient indiscernables
 * dans la liste vocale de Discord.
 */
const NAME_PATTERN = /\{index\}/;

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Le gabarit du sujet n'impose aucun jeton : un serveur peut vouloir n'y
 * afficher que le sujet libre. Seule sa longueur est bornee, sur le plafond
 * de Discord.
 */
const STATUS_PATTERN_MAX = MAX_VOICE_STATUS_LENGTH;

export class CreateVoiceHubDto {
	@IsString()
	@MinLength(1)
	@MaxLength(100)
	name!: string;

	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Matches(NAME_PATTERN, {
		message: "namePattern doit contenir {index}.",
	})
	namePattern?: string;

	@IsOptional()
	@IsString()
	@MaxLength(STATUS_PATTERN_MAX)
	statusPattern?: string;

	@IsOptional()
	@IsEnum(VoicePlacementMode)
	placementMode?: VoicePlacementMode;

	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(100)
	landingCategoryName?: string;

	/**
	 * Vider l'identifiant est le seul moyen de faire retrouver — ou recreer —
	 * la categorie d'accueil, d'ou le `null` explicitement accepte.
	 */
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE, { message: "landingCategoryId doit être un identifiant Discord." })
	landingCategoryId?: string | null;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(99)
	userLimit?: number;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(1000)
	position?: number;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;
}

export class UpdateVoiceHubDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(100)
	name?: string;

	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Matches(NAME_PATTERN, {
		message: "namePattern doit contenir {index}.",
	})
	namePattern?: string;

	@IsOptional()
	@IsString()
	@MaxLength(STATUS_PATTERN_MAX)
	statusPattern?: string;

	@IsOptional()
	@IsEnum(VoicePlacementMode)
	placementMode?: VoicePlacementMode;

	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(100)
	landingCategoryName?: string;

	/**
	 * Vider l'identifiant est le seul moyen de faire retrouver — ou recreer —
	 * la categorie d'accueil, d'ou le `null` explicitement accepte.
	 */
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE, { message: "landingCategoryId doit être un identifiant Discord." })
	landingCategoryId?: string | null;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(99)
	userLimit?: number;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(1000)
	position?: number;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;
}

/** Libelle affiche dans le select de la modale et dans le sujet du salon. */
const LABEL_MAX = 40;

/**
 * Emoji d'une option : unicode, ou `<:nom:id>` / `<a:nom:id>` pour un emoji
 * personnalise du serveur — le sujet d'un salon vocal les rend tous les deux.
 * `null` efface celui deja pose.
 */
const EMOJI_MAX = 64;

export class CreateVoiceHubRankDto {
	@IsString()
	@MinLength(1)
	@MaxLength(LABEL_MAX)
	label!: string;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(EMOJI_MAX)
	emoji?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE, { message: "categoryId doit être un identifiant Discord." })
	categoryId?: string | null;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(1000)
	position?: number;
}

export class UpdateVoiceHubRankDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(LABEL_MAX)
	label?: string;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(EMOJI_MAX)
	emoji?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE, { message: "categoryId doit être un identifiant Discord." })
	categoryId?: string | null;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(1000)
	position?: number;
}

export class CreateVoiceHubPlatformDto {
	@IsString()
	@MinLength(1)
	@MaxLength(LABEL_MAX)
	label!: string;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(EMOJI_MAX)
	emoji?: string | null;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(1000)
	position?: number;
}

export class UpdateVoiceHubPlatformDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(LABEL_MAX)
	label?: string;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(EMOJI_MAX)
	emoji?: string | null;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(1000)
	position?: number;
}
