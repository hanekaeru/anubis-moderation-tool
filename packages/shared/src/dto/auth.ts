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

export interface SessionUser {
	id: string;
	username: string;
	displayName: string;
	role: AppUserRole;
	permissions: Permission[];
	mustChangePassword: boolean;
	discordUserId: Snowflake | null;
	lastLoginAt: IsoDateString | null;
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
