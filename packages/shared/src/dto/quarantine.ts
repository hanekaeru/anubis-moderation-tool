import { IsoDateString, Snowflake } from "./common";

/** Doit rester identique au `@default` de `QuarantineConfig.buttonLabel`. */
export const DEFAULT_QUARANTINE_BUTTON_LABEL = "J'accepte le reglement";

export const DEFAULT_QUARANTINE_MESSAGE =
	"Bienvenue ! Prends connaissance du reglement, puis clique sur le bouton ci-dessous pour acceder au serveur.";

export interface QuarantineConfigDto {
	guildId: Snowflake;
	enabled: boolean;
	/** Role attribue a l'arrivee, retire a l'acceptation. */
	roleId: Snowflake | null;
	/** Salon ou `/quarantaine-message` publie l'embed et son bouton. */
	channelId: Snowflake | null;
	message: string | null;
	buttonLabel: string;
	updatedAt: IsoDateString;
}

export interface UpdateQuarantineConfigRequest {
	enabled?: boolean;
	roleId?: Snowflake | null;
	channelId?: Snowflake | null;
	message?: string | null;
	buttonLabel?: string;
}

export interface QuarantineStatusDto {
	guildId: Snowflake;
	userId: Snowflake;
	username: string;
	displayName: string | null;
	avatarUrl: string | null;
	quarantinedAt: IsoDateString;
	acceptedAt: IsoDateString | null;
	/** Compte dashboard ayant leve la quarantaine a la main, le cas echeant. */
	releasedBy: string | null;
	/** Reglement pas encore accepte : le membre est toujours bloque. */
	active: boolean;
	/** Levee enregistree mais pas encore rejouee sur Discord par le bot. */
	pendingSync: boolean;
}
