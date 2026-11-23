import { Type } from "class-transformer";
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsBoolean,
	IsEnum,
	IsIn,
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
import {
	MAX_MINIGAME_ATTEMPTS,
	MAX_MINIGAME_XP,
	MAX_MINIGAME_XP_STEPS,
	MINIGAME_LIMITS,
	MinigameType,
} from "@anubis/shared";

const SNOWFLAKE = /^\d{17,20}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `null` explicite autorise : il efface le champ. */
const nullable = () => ValidateIf((_, value) => value !== null);

/**
 * Champs d'un jeu hors type et titre, tous facultatifs : la modification n'envoie que ce qui
 * change. La coherence avec le type (reponse presente, sondage complet) se
 * verifie dans le service, sur le jeu complet — un champ absent se lit alors
 * sur la ligne existante.
 */
abstract class MinigameEventFieldsDto {
	@IsOptional()
	@nullable()
	@IsString()
	@MaxLength(MINIGAME_LIMITS.description)
	description?: string | null;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	@Max(0xffffff)
	color?: number;

	@IsOptional()
	@IsBoolean()
	pingEnabled?: boolean;

	@IsOptional()
	@nullable()
	@Matches(SNOWFLAKE)
	pingRoleId?: string | null;

	@IsOptional()
	@nullable()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(MAX_MINIGAME_ATTEMPTS)
	maxAttempts?: number | null;

	@IsOptional()
	@nullable()
	@IsString()
	@MaxLength(MINIGAME_LIMITS.outOfAttemptsMessage)
	outOfAttemptsMessage?: string | null;

	@IsOptional()
	@nullable()
	@Matches(KEY)
	@MaxLength(40)
	answerHeroKey?: string | null;

	@IsOptional()
	@nullable()
	@Matches(KEY)
	@MaxLength(40)
	answerMapKey?: string | null;

	@IsOptional()
	@nullable()
	@IsString()
	@MaxLength(MINIGAME_LIMITS.skin)
	answerSkin?: string | null;

	@IsOptional()
	@nullable()
	@IsBoolean()
	answerTrue?: boolean | null;

	@IsOptional()
	@nullable()
	@IsString()
	@MaxLength(MINIGAME_LIMITS.pollQuestion)
	pollQuestion?: string | null;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(MINIGAME_LIMITS.pollAnswersMax)
	@IsString({ each: true })
	@MaxLength(MINIGAME_LIMITS.pollAnswer, { each: true })
	pollAnswers?: string[];
}

export class UpdateMinigameEventDto extends MinigameEventFieldsDto {
	@IsOptional()
	@IsEnum(MinigameType)
	type?: MinigameType;

	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(MINIGAME_LIMITS.title)
	title?: string;
}

/**
 * Les champs requis sont redeclares ici plutot qu'herites : class-validator
 * cumule les decorateurs le long de l'heritage, et un `@IsOptional()` du parent
 * rendrait le type facultatif a la creation aussi.
 */
export class CreateMinigameEventDto extends MinigameEventFieldsDto {
	@Matches(DATE_KEY, { message: "Le jour doit être au format AAAA-MM-JJ." })
	day!: string;

	@IsEnum(MinigameType)
	type!: MinigameType;

	@IsString()
	@MinLength(1)
	@MaxLength(MINIGAME_LIMITS.title)
	title!: string;
}

export class CalendarQueryDto {
	@Matches(DATE_KEY)
	from!: string;

	@Matches(DATE_KEY)
	to!: string;
}

/** Bareme d'un jeu `/devine` : au moins une ligne, des zeros pour « rien ». */
function XpTable() {
	return function (target: object, key: string) {
		IsOptional()(target, key);
		IsArray()(target, key);
		ArrayMinSize(1, { message: "Le barème doit compter au moins une ligne." })(target, key);
		ArrayMaxSize(MAX_MINIGAME_XP_STEPS)(target, key);
		IsInt({ each: true })(target, key);
		Min(0, { each: true })(target, key);
		Max(MAX_MINIGAME_XP, { each: true })(target, key);
	};
}

export class UpdateMinigameConfigDto {
	@IsOptional()
	@nullable()
	@Matches(SNOWFLAKE)
	announceChannelId?: string | null;

	@IsOptional()
	@nullable()
	@Matches(SNOWFLAKE)
	playChannelId?: string | null;

	@IsOptional()
	@nullable()
	@Matches(SNOWFLAKE)
	pingRoleId?: string | null;

	@IsOptional()
	@Matches(TIME, { message: "L'heure doit être au format HH:MM." })
	pingTime?: string;

	/** Sept cases, lundi en premier ; `null` = aucun jeu ce jour-la. */
	@IsOptional()
	@IsArray()
	@ArrayMinSize(7)
	@ArrayMaxSize(7)
	@IsIn([...Object.values(MinigameType), null], { each: true })
	weekTemplate?: (MinigameType | null)[];

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(MAX_MINIGAME_ATTEMPTS)
	maxAttempts?: number;

	@XpTable()
	heroXp?: number[];

	@XpTable()
	mapXp?: number[];

	@XpTable()
	skinXp?: number[];

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	@Max(MAX_MINIGAME_XP)
	trueFalseXp?: number;

	@IsOptional()
	@nullable()
	@IsString()
	@MaxLength(MINIGAME_LIMITS.outOfAttemptsMessage)
	outOfAttemptsMessage?: string | null;
}

export class CreateMinigameMapDto {
	@IsString()
	@MinLength(1)
	@MaxLength(60)
	name!: string;
}

export class UpdateMinigameMapDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(60)
	name?: string;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;
}
