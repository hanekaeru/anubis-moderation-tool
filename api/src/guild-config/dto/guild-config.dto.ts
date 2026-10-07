import {
	IsBoolean,
	IsIn,
	IsObject,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
} from "class-validator";
import { GuildRoleKey, type Snowflake } from "@anubis/shared";

export class CreateGuildConfigDto {
	@IsString()
	@MinLength(1)
	@MaxLength(50)
	configName!: string;

	@IsString()
	@MinLength(1)
	@MaxLength(100)
	configValue!: string;

	@IsString()
	@MinLength(1)
	configDescription!: string;
}

export class UpdateGuildConfigDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(100)
	configValue?: string;

	@IsOptional()
	@IsString()
	@MinLength(1)
	configDescription?: string;
}

/**
 * Le dictionnaire de roles est valide par le service, pas par des decorateurs :
 * ses cles sont celles de `GuildRoleKey` et ses valeurs des identifiants
 * Discord, deux contraintes que `class-validator` ne sait pas poser sur un
 * `Record` sans en faire une classe par cle.
 */
export class UpdateMentionSettingsDto {
	@IsObject()
	roles!: Record<string, Snowflake | null>;

	@IsOptional()
	@IsIn(Object.values(GuildRoleKey))
	alertRoleKey!: GuildRoleKey | null;

	@IsBoolean()
	mentionMembers!: boolean;
}
