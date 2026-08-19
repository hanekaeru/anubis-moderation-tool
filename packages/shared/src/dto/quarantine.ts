import { IsoDateString, Snowflake } from "./common";

/** Doit rester identique au `@default` de `QuarantineConfig.buttonLabel`. */
export const DEFAULT_QUARANTINE_BUTTON_LABEL = "J'accepte le reglement";

/**
 * Doit rester identique au `@default` de
 * `QuarantineConfig.battlenetButtonLabel`.
 */
export const DEFAULT_QUARANTINE_BATTLENET_BUTTON_LABEL =
	"Verifier mon compte Battle.net";

export const DEFAULT_QUARANTINE_MESSAGE =
	"Bienvenue ! Prends connaissance du reglement, puis clique sur le bouton ci-dessous pour acceder au serveur.";

export const DEFAULT_QUARANTINE_BATTLENET_MESSAGE =
	"Derniere etape : lie ton compte Battle.net pour ouvrir l'acces complet au serveur.";

/**
 * Plafond par liste de roles appliques a la levee.
 *
 * Chaque levee se joue en un seul `roles.set` : la borne protege moins la base
 * que la requete Discord, dont l'echec est global — un lot demesure ferait
 * echouer la levee entiere, pas seulement le role fautif.
 */
export const MAX_QUARANTINE_RELEASE_ROLES = 10;

/**
 * Duree de validite d'une demande de verification Battle.net.
 *
 * Assez large pour une connexion Blizzard avec double authentification, assez
 * courte pour qu'un lien intercepte ne serve pas le lendemain.
 */
export const BATTLENET_STATE_TTL_MINUTES = 15;

export interface QuarantineConfigDto {
	guildId: Snowflake;
	enabled: boolean;
	/** Role attribue a l'arrivee, retire a la levee complete. */
	roleId: Snowflake | null;
	/** Salon ou `/quarantaine-message` publie l'embed et ses boutons. */
	channelId: Snowflake | null;
	message: string | null;
	buttonLabel: string;
	/** Roles donnes a la levee complete — toutes les etapes exigees franchies. */
	releaseAddRoleIds: Snowflake[];
	/** Roles retires a la levee complete, en plus du role de quarantaine. */
	releaseRemoveRoleIds: Snowflake[];
	/** Roles appliques quand le reglement seul a ete accepte. */
	acceptAddRoleIds: Snowflake[];
	acceptRemoveRoleIds: Snowflake[];
	/** Roles appliques quand le compte Battle.net seul a ete verifie. */
	verifyAddRoleIds: Snowflake[];
	verifyRemoveRoleIds: Snowflake[];
	/** Seconde etape exigee : lier un compte Battle.net verifie. */
	battlenetRequired: boolean;
	battlenetButtonLabel: string;
	battlenetMessage: string | null;
	/**
	 * Client OAuth Blizzard renseigne cote API. En lecture seule : le reglage
	 * vit dans l'environnement, le dashboard ne fait que le refleter.
	 */
	battlenetAvailable: boolean;
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
	acceptAddRoleIds?: Snowflake[];
	acceptRemoveRoleIds?: Snowflake[];
	verifyAddRoleIds?: Snowflake[];
	verifyRemoveRoleIds?: Snowflake[];
	battlenetRequired?: boolean;
	battlenetButtonLabel?: string;
	battlenetMessage?: string | null;
}

export interface QuarantineStatusDto {
	guildId: Snowflake;
	userId: Snowflake;
	username: string;
	displayName: string | null;
	avatarUrl: string | null;
	quarantinedAt: IsoDateString;
	acceptedAt: IsoDateString | null;
	/** Verification Battle.net reussie, `null` si elle manque encore. */
	battlenetVerifiedAt: IsoDateString | null;
	/**
	 * BattleTag du compte lie.
	 *
	 * `null` pour un appelant sans `battlenet:read`, y compris quand le membre
	 * est bel et bien verifie : c'est l'identite Blizzard qui est protegee, pas
	 * le fait d'avoir franchi l'etape — `battlenetVerifiedAt` reste lisible par
	 * toute l'equipe.
	 */
	battletag: string | null;
	/** Compte dashboard ayant leve la quarantaine a la main, le cas echeant. */
	releasedBy: string | null;
	/** Une etape exigee manque encore : le membre est toujours bloque. */
	active: boolean;
	/** Levee enregistree mais pas encore rejouee sur Discord par le bot. */
	pendingSync: boolean;
}

/** Lien verifie entre un compte Discord et un compte Battle.net. */
export interface BattlenetLinkDto {
	userId: Snowflake;
	/** `null` sans la permission `battlenet:read`. */
	battletag: string | null;
	verifiedAt: IsoDateString;
}

/**
 * Ou en est un membre dans son parcours de quarantaine.
 *
 * Partage entre le bot (qui applique les roles), l'API (qui expose l'etat) et
 * le dashboard (qui l'affiche) : les trois doivent s'accorder sur ce que
 * « libere » veut dire, sinon un membre apparaitrait bloque dans la liste alors
 * que le bot lui a deja tout ouvert.
 */
export const QuarantineStage = {
	/** Rien de franchi. */
	PENDING: "PENDING",
	/** Reglement accepte, verification Battle.net encore attendue. */
	ACCEPTED_ONLY: "ACCEPTED_ONLY",
	/** Compte verifie, reglement pas encore accepte. */
	VERIFIED_ONLY: "VERIFIED_ONLY",
	/** Toutes les etapes exigees sont franchies : acces complet. */
	CLEARED: "CLEARED",
} as const;
export type QuarantineStage =
	(typeof QuarantineStage)[keyof typeof QuarantineStage];

/**
 * Etape courante d'un membre.
 *
 * Quand la verification Battle.net n'est **pas** exigee, l'acceptation du
 * reglement suffit a liberer — un membre qui se serait verifie malgre tout
 * reste en attente de cette acceptation. C'est ce qui fait que couper le
 * reglage rend exactement le comportement d'avant, sans laisser personne
 * coince dans un etat intermediaire.
 */
export function quarantineStage(
	progress: {
		acceptedAt: Date | string | null;
		battlenetVerifiedAt: Date | string | null;
		/** Levee prononcee a la main depuis le dashboard. */
		releasedById?: string | null;
	},
	battlenetRequired: boolean,
): QuarantineStage {
	// Une levee manuelle passe outre toutes les etapes : le staff a tranche, et
	// le bot doit ouvrir l'acces sans attendre une verification qui n'arrivera
	// jamais — c'est precisement pour les cas ou elle ne peut pas aboutir que le
	// bouton existe.
	if (progress.releasedById) return QuarantineStage.CLEARED;

	const accepted = progress.acceptedAt !== null;
	const verified = progress.battlenetVerifiedAt !== null;

	if (!battlenetRequired) {
		return accepted ? QuarantineStage.CLEARED : QuarantineStage.PENDING;
	}

	if (accepted && verified) return QuarantineStage.CLEARED;
	if (accepted) return QuarantineStage.ACCEPTED_ONLY;
	if (verified) return QuarantineStage.VERIFIED_ONLY;
	return QuarantineStage.PENDING;
}

/**
 * Etat du client OAuth Battle.net sur ce deploiement, en lecture seule.
 *
 * Il vient de l'environnement de l'API, pas de la base : le dashboard ne peut
 * pas le changer, seulement le constater. Sans cette remontee, on reglerait
 * `battlenetRequired` a `true` sur un serveur ou la verification ne peut pas
 * aboutir, et les arrivants resteraient bloques sans que rien ne l'annonce.
 */
export interface QuarantineBattlenetAvailability {
	battlenetAvailable: boolean;
}
