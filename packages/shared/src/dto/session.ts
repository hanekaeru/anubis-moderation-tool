import { AppUserRole } from "../enums";
import { IsoDateString } from "./common";

/**
 * Contrats de la page « Sessions actives », reservee au proprietaire.
 *
 * Une session n'est pas un refresh token mais une **famille** : la rotation en
 * cree un nouveau a chaque rafraichissement, et les compter un par un
 * afficherait des dizaines de lignes pour un seul navigateur. La famille est
 * l'unite qu'on ouvre en se connectant et qu'on ferme en se deconnectant.
 */

export interface SessionDto {
	/** Identifiant de famille : c'est lui qu'on revoque. */
	familyId: string;
	appUserId: string;
	username: string;
	displayName: string;
	role: AppUserRole;
	/** Navigateur declare a la derniere rotation. */
	userAgent: string | null;
	ip: string | null;
	/** Ouverture de la session : premier jeton de la famille. */
	startedAt: IsoDateString;
	/** Dernier rafraichissement observe, donc dernier signe de vie. */
	lastSeenAt: IsoDateString;
	expiresAt: IsoDateString;
	/** Nombre de rotations, un indicateur grossier d'anciennete d'usage. */
	rotationCount: number;
	/**
	 * Vrai pour la session depuis laquelle la page est consultee.
	 *
	 * Sans ce reperage, se couper soi-meme en croyant fermer une session
	 * etrangere serait l'erreur la plus facile a commettre sur cette page.
	 */
	current: boolean;
}

export interface SessionSearchQuery {
	/** Restreint a un compte. A defaut, toutes les sessions du dashboard. */
	appUserId?: string;
	/** Inclut les sessions revoquees ou expirees, pour enqueter. */
	includeInactive?: boolean;
}

export interface RevokeSessionsResponse {
	/** Nombre de jetons effectivement revoques. */
	revoked: number;
}
