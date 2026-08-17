import { IsoDateString } from "./common";

/**
 * Etat du process bot, reconstitue depuis son battement de coeur en base.
 * `null` quand le bot n'a jamais tourne : aucune ligne n'a encore ete ecrite.
 */
export interface BotStatusDto {
	online: boolean;
	startedAt: IsoDateString;
	lastHeartbeatAt: IsoDateString;
	/** Latence de la passerelle Discord au dernier battement. */
	wsPingMs: number | null;
	/** Moyenne glissante des derniers battements. */
	avgPingMs: number | null;
	guildCount: number;
	uptimeSeconds: number;
}

export interface ApiStatusDto {
	uptimeSeconds: number;
	database: { reachable: boolean; latencyMs: number | null };
}

export type StatusProblemSeverity = "warning" | "critical";

export interface StatusProblemDto {
	severity: StatusProblemSeverity;
	message: string;
}

export interface StatusDto {
	bot: BotStatusDto | null;
	api: ApiStatusDto;
	/** Confinement anti-raid en cours : remonte comme probleme, pas comme panne. */
	activeRaidLockdown: boolean;
	automodIncidents24h: number;
	/** Vide quand tout va bien — c'est le seul indicateur a lire en cas de doute. */
	problems: StatusProblemDto[];
	checkedAt: IsoDateString;
}
