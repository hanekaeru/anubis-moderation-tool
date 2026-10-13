import { IsBoolean, IsOptional, IsString, Matches, MaxLength, ValidateIf } from "class-validator";
import { MAX_WELCOME_MESSAGE_LENGTH } from "@anubis/shared";

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * `null` est une valeur utile pour chaque champ facultatif : il detache un
 * salon ou remet le texte par defaut. Meme convention que `UpdateXpConfigDto`.
 */
export class UpdateWelcomeConfigDto {
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE, { message: "Identifiant de salon invalide." })
	channelId?: string | null;

	@IsOptional()
	@IsBoolean()
	joinEnabled?: boolean;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(MAX_WELCOME_MESSAGE_LENGTH)
	joinMessage?: string | null;

	@IsOptional()
	@IsBoolean()
	leaveEnabled?: boolean;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(MAX_WELCOME_MESSAGE_LENGTH)
	leaveMessage?: string | null;

	@IsOptional()
	@IsBoolean()
	boostEnabled?: boolean;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE, { message: "Identifiant de salon invalide." })
	boostChannelId?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(MAX_WELCOME_MESSAGE_LENGTH)
	boostMessage?: string | null;
}
