import {
	IsBoolean,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	MinLength,
	ValidateIf,
} from "class-validator";

const SNOWFLAKE = /^\d{17,20}$/;

export class UpdateQuarantineConfigDto {
	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	// `null` est une valeur utile ici : elle detache le role sans desactiver la
	// quarantaine. Meme convention que `RaidConfig.alertRoleId`.
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE)
	roleId?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE)
	channelId?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(4000)
	message?: string | null;

	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(80)
	buttonLabel?: string;
}
