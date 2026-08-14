import { IsoDateString, Snowflake } from "./common";

/** Duree de validite d'un code de liaison, en minutes — partagee API/webapp. */
export const DISCORD_LINK_CODE_TTL_MINUTES = 15;

export interface DiscordLinkCodeDto {
	code: string;
	expiresAt: IsoDateString;
}

export interface DiscordLinkStatusDto {
	discordUserId: Snowflake | null;
	discordUsername: string | null;
}
