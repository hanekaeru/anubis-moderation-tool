import { Snowflake } from "./common";

export interface GuildConfigDto {
	id: string;
	guildId: Snowflake;
	configName: string;
	configValue: string;
	configDescription: string;
}

export interface CreateGuildConfigRequest {
	configName: string;
	configValue: string;
	configDescription: string;
}

export interface UpdateGuildConfigRequest {
	configValue?: string;
	configDescription?: string;
}
