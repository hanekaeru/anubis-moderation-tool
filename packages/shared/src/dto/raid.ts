import { IsoDateString, Snowflake } from "./common";

export interface RaidConfigDto {
	guildId: Snowflake;
	enabled: boolean;
	joinThreshold: number;
	windowSeconds: number;
	lockdownMinutes: number;
	alertRoleId: Snowflake | null;
	updatedAt: IsoDateString;
}

export interface UpdateRaidConfigRequest {
	enabled?: boolean;
	joinThreshold?: number;
	windowSeconds?: number;
	lockdownMinutes?: number;
	alertRoleId?: Snowflake | null;
}

export interface RaidIncidentDto {
	id: string;
	guildId: Snowflake;
	triggeredAt: IsoDateString;
	joinCount: number;
	windowSeconds: number;
	memberIds: Snowflake[];
	lockedChannelIds: Snowflake[];
	resolvedAt: IsoDateString | null;
	resolvedBy: string | null;
	/** Confinement toujours actif cote Discord (salons encore verrouilles). */
	active: boolean;
}
