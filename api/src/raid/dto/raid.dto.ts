import { IsBoolean, IsInt, IsOptional, Matches, Max, Min, ValidateIf } from "class-validator";

const SNOWFLAKE = /^\d{17,20}$/;

export class UpdateRaidConfigDto {
	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	@IsOptional()
	@IsInt()
	@Min(2)
	@Max(1000)
	joinThreshold?: number;

	@IsOptional()
	@IsInt()
	@Min(5)
	@Max(3600)
	windowSeconds?: number;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(1440)
	lockdownMinutes?: number;

	// `null` est une valeur utile ici : elle retire l'alerte de mention.
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE)
	alertRoleId?: string | null;
}
