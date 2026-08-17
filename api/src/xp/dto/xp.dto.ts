import { Type } from "class-transformer";
import {
	IsBoolean,
	IsInt,
	IsOptional,
	IsString,
	Matches,
	Max,
	MaxLength,
	Min,
} from "class-validator";
import { MAX_XP_REWARD_LEVEL } from "@anubis/shared";
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
