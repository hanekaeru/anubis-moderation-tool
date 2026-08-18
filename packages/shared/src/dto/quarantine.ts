import { IsoDateString, Snowflake } from "./common";

/** Doit rester identique au `@default` de `QuarantineConfig.buttonLabel`. */
export const DEFAULT_QUARANTINE_BUTTON_LABEL = "J'accepte le reglement";

export const DEFAULT_QUARANTINE_MESSAGE =
	"Bienvenue ! Prends connaissance du reglement, puis clique sur le bouton ci-dessous pour acceder au serveur.";

/**
 * Plafond par liste de roles appliques a la levee.
 *
 * Chaque levee se joue en un seul `roles.set` : la borne protege moins la base
 * que la requete Discord, dont l'echec est global — un lot demesure ferait
 * echouer la levee entiere, pas seulement le role fautif.
 */
export const MAX_QUARANTINE_RELEASE_ROLES = 10;

export interface QuarantineConfigDto {
	guildId: Snowflake;
	enabled: boolean;
	/** Role attribue a l'arrivee, retire a l'acceptation. */
	roleId: Snowflake | null;
	/** Salon ou `/quarantaine-message` publie l'embed et son bouton. */
	channelId: Snowflake | null;
	message: string | null;
	buttonLabel: string;
	/** Roles donnes a la levee — acceptation du reglement ou deblocage webapp. */
	releaseAddRoleIds: Snowflake[];
	/** Roles retires a la levee, en plus du role de quarantaine lui-meme. */
	releaseRemoveRoleIds: Snowflake[];
	updatedAt: IsoDateString;
}

export interface UpdateQuarantineConfigRequest {
	enabled?: boolean;
	roleId?: Snowflake | null;
	channelId?: Snowflake | null;
	message?: string | null;
	buttonLabel?: string;
	releaseAddRoleIds?: Snowflake[];
	releaseRemoveRoleIds?: Snowflake[];
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
