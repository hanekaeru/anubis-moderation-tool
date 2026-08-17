import { Type } from "class-transformer";
import {
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
	Validate,
	ValidatorConstraint,
	type ValidatorConstraintInterface,
} from "class-validator";
import {
	GiveawayStatus,
	MAX_GIVEAWAY_DURATION_MINUTES,
	MAX_GIVEAWAY_WINNERS,
	MIN_GIVEAWAY_DURATION_MINUTES,
	isValidGiveawayEmoji,
} from "@anubis/shared";
import { PaginationDto } from "../../common/dto/pagination.dto";

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * L'emoji de participation n'a pas de forme reguliere unique : un emoji
 * personnalise du serveur et un emoji Unicode ne se ressemblent pas. La regle
 * vit dans `@anubis/shared` pour que le dashboard refuse la meme chose que
 * l'API, sans la reecrire.
 */
@ValidatorConstraint({ name: "giveawayEmoji" })
class GiveawayEmojiConstraint implements ValidatorConstraintInterface {
	validate(value: unknown): boolean {
		return typeof value === "string" && isValidGiveawayEmoji(value);
	}

	defaultMessage(): string {
		return "reactionEmoji doit être un emoji ou un emoji personnalisé du serveur.";
	}
}

export class CreateGiveawayDto {
	@Matches(SNOWFLAKE)
	channelId!: string;

	@IsString()
	@MinLength(3)
	@MaxLength(160)
	title!: string;

	@IsOptional()
	@IsString()
	@MaxLength(2000)
	description?: string;

	@IsString()
	@MinLength(1)
	@MaxLength(200)
	prize!: string;

	// L'image n'est pas telechargee : seule une URL est conservee, et c'est
	// Discord qui la rendra. Le protocole est donc contraint ici.
	@IsOptional()
	@IsUrl({ protocols: ["http", "https"], require_protocol: true })
	imageUrl?: string;

	@IsOptional()
	@Validate(GiveawayEmojiConstraint)
	reactionEmoji?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(MAX_GIVEAWAY_WINNERS)
	winnerCount?: number;

	@IsOptional()
	@Matches(SNOWFLAKE)
	announceChannelId?: string;

	@Type(() => Number)
	@IsInt()
	@Min(MIN_GIVEAWAY_DURATION_MINUTES)
	@Max(MAX_GIVEAWAY_DURATION_MINUTES)
	durationMinutes!: number;
}

export class UpdateGiveawayDto {
	@IsOptional()
	@IsString()
	@MinLength(3)
	@MaxLength(160)
	title?: string;

	@IsOptional()
	@IsString()
	@MaxLength(2000)
	description?: string | null;

	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(200)
	prize?: string;

	@IsOptional()
	@IsUrl({ protocols: ["http", "https"], require_protocol: true })
	imageUrl?: string | null;

	@IsOptional()
	@Validate(GiveawayEmojiConstraint)
	reactionEmoji?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(MAX_GIVEAWAY_WINNERS)
	winnerCount?: number;

	@IsOptional()
	@Matches(SNOWFLAKE)
	announceChannelId?: string | null;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(MIN_GIVEAWAY_DURATION_MINUTES)
	@Max(MAX_GIVEAWAY_DURATION_MINUTES)
	durationMinutes?: number;
}

export class GiveawayQueryDto extends PaginationDto {
	@IsOptional()
	@IsIn(Object.values(GiveawayStatus))
	status?: GiveawayStatus;
}
