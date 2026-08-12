import { SetMetadata } from "@nestjs/common";

export const ALLOW_TEMPORARY_PASSWORD_KEY = "allowTemporaryPassword";

/**
 * Autorise une route a repondre a un compte dont le mot de passe est encore
 * provisoire.
 *
 * Reserve aux routes d'authentification : sans elles, un compte fraichement
 * cree ne pourrait ni consulter son etat ni changer son mot de passe, donc
 * jamais sortir de cet etat.
 */
export const AllowTemporaryPassword = () =>
	SetMetadata(ALLOW_TEMPORARY_PASSWORD_KEY, true);
