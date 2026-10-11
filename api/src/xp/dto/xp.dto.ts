import { Type } from "class-transformer";
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	Matches,
	Max,
	MaxLength,
	Min,
	ValidateIf,
} from "class-validator";
import {
	MAX_XP_BLOCKED_CHANNELS,
	MAX_XP_LEVEL_UP_MESSAGE_LENGTH,
	MAX_XP_REWARD_LEVEL,
	XpAnnouncementMode,
} from "@anubis/shared";
import { PaginationDto } from "../../common/dto/pagination.dto";

const SNOWFLAKE = /^\d{17,20}$/;

export class XpLeaderboardQueryDto extends PaginationDto {
	@IsOptional()
	@IsString()
	@MaxLength(100)
	search?: string;
}

export class CreateXpRewardRoleDto {
	@Matches(SNOWFLAKE)
	roleId!: string;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(MAX_XP_REWARD_LEVEL)
	level!: number;

	@IsOptional()
	@IsBoolean()
	replacePrevious?: boolean;
}

export class UpdateXpRewardRoleDto {
	@IsOptional()
	@Matches(SNOWFLAKE)
	roleId?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(MAX_XP_REWARD_LEVEL)
	level?: number;

	@IsOptional()
	@IsBoolean()
	replacePrevious?: boolean;
}

export class UpdateXpConfigDto {
	@IsOptional()
	@IsEnum(XpAnnouncementMode)
	mode?: XpAnnouncementMode;

	// `null` est une valeur utile ici : elle detache le salon d'annonce sans
	// changer de mode. Meme convention que `QuarantineConfig.channelId`.
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE)
	channelId?: string | null;

	/** `null` remet le gabarit par defaut du mode. */
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(MAX_XP_LEVEL_UP_MESSAGE_LENGTH)
	message?: string | null;

	@IsOptional()
	@IsBoolean()
	pingMember?: boolean;

	/**
	 * Salons ou ecrire ne rapporte aucune experience.
	 *
	 * Remplacee en bloc : `[]` vide la liste, et c'est le seul moyen de le
	 * faire. `ArrayMaxSize` borne la saisie — au-dela, c'est le gain d'XP
	 * lui-meme qu'il faut couper.
	 */
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(MAX_XP_BLOCKED_CHANNELS)
	@Matches(SNOWFLAKE, { each: true, message: "Identifiant de salon invalide." })
	blockedChannelIds?: string[];
}
