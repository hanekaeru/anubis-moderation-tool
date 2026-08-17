import { AppUserRole } from "../enums";
import { Permission } from "../permissions";
import { IsoDateString, Snowflake } from "./common";

export interface LoginRequest {
	username: string;
	password: string;
}

/**
 * Le refresh token n'apparait pas ici : il est pose en cookie httpOnly par
 * l'API et n'est jamais lisible par le JavaScript du navigateur.
 */
export interface LoginResponse {
	accessToken: string;
	/** Duree de validite de l'access token, en secondes. */
	expiresIn: number;
	user: SessionUser;
}

/**
 * Reponse au premier facteur quand le compte porte une double
 * authentification : aucun jeton de session n'est encore emis.
 *
 * Le `challengeToken` prouve seulement que le mot de passe etait bon. Il est
 * court, a usage unique cote serveur, et n'ouvre aucune route de l'API : sans
 * le second facteur il ne mene nulle part.
 */
export interface TwoFactorChallengeResponse {
	twoFactorRequired: true;
	challengeToken: string;
	/** Duree de validite du defi, en secondes. */
	expiresIn: number;
}

/**
 * Le login repond l'un **ou** l'autre. Le discriminant est `twoFactorRequired`,
 * absent de `LoginResponse` : le dashboard n'a qu'un champ a tester.
 */
export type LoginResult = LoginResponse | TwoFactorChallengeResponse;

export function isTwoFactorChallenge(
	result: LoginResult,
): result is TwoFactorChallengeResponse {
	return (result as TwoFactorChallengeResponse).twoFactorRequired === true;
}

export interface TwoFactorLoginRequest {
	challengeToken: string;
	/** Code a six chiffres, ou code de secours. */
	code: string;
}

/** Etat de la double authentification du compte connecte. */
export interface TwoFactorStatus {
	/**
	 * Proposee sur ce deploiement (`TWO_FACTOR_ENABLED` cote API).
	 *
	 * A `false`, le second facteur n'est plus demande a la connexion et les
	 * ecrans de configuration sont fermes. Distinct de `enabled`, qui decrit le
	 * compte : un compte peut avoir active la protection sur un serveur qui l'a
	 * depuis coupee — son secret est conserve, mais il ne protege plus rien.
	 */
	available: boolean;
	enabled: boolean;
	enabledAt: IsoDateString | null;
	/** Codes de secours encore utilisables. */
	remainingRecoveryCodes: number;
}

/**
 * Preparation : le secret est genere et enregistre, mais la double
 * authentification **n'est pas encore active**. Elle ne le devient qu'apres un
 * premier code valide — sinon un secret mal recopie fermerait le compte.
 */
export interface TwoFactorSetupResponse {
	/** Secret en base32, a saisir a la main quand le QR ne peut pas etre scanne. */
	secret: string;
	/** URI `otpauth://`, ce que le QR code encode. */
	otpauthUri: string;
	/** QR code prêt a afficher, en `data:image/...`. */
	qrCodeDataUri: string;
}

/**
 * Codes de secours, montres **une seule fois**.
 *
 * Ils ne sont stockes que haches : l'API elle-meme ne peut plus les afficher
 * apres cette reponse, seulement en generer de nouveaux.
 */
export interface TwoFactorRecoveryCodesResponse {
	codes: string[];
}

/**
 * Desactivation : mot de passe **et** code valide.
 *
 * Le mot de passe seul suffirait a quelqu'un qui a trouve une session ouverte ;
 * exiger les deux fait de la desactivation une operation aussi difficile que la
 * connexion elle-meme.
 */
export interface DisableTwoFactorRequest {
	password: string;
	code: string;
}

/** Longueur du code temporel, fixee par les applications d'authentification. */
export const TOTP_CODE_LENGTH = 6;

/** Nombre de codes de secours remis a l'activation. */
export const RECOVERY_CODE_COUNT = 10;

export interface SessionUser {
	id: string;
	username: string;
	displayName: string;
	role: AppUserRole;
	permissions: Permission[];
	mustChangePassword: boolean;
	discordUserId: Snowflake | null;
	lastLoginAt: IsoDateString | null;
	/** Double authentification active sur ce compte. */
	twoFactorEnabled: boolean;
	/**
	 * Double authentification proposee par ce deploiement.
	 *
	 * Porte par la session plutot que lue par un appel separe : le cadre de
	 * l'application doit savoir des le premier rendu s'il affiche l'entree de
	 * menu, et une requete de plus au demarrage pour un booleen de configuration
	 * serait payee a chaque chargement de page.
	 */
	twoFactorAvailable: boolean;
}

export interface ChangePasswordRequest {
	currentPassword: string;
	newPassword: string;
}

/** Contrainte appliquee a l'identique cote API et cote formulaire Angular. */
export const PASSWORD_MIN_LENGTH = 12;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_PATTERN = "^[a-zA-Z0-9._-]+$";
