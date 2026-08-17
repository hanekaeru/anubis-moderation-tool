import { IsString, MaxLength, MinLength } from "class-validator";
import {
	PASSWORD_MIN_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
} from "@anubis/shared";

export class LoginDto {
	@IsString()
	@MinLength(USERNAME_MIN_LENGTH)
	@MaxLength(USERNAME_MAX_LENGTH)
	username!: string;

	// Aucune contrainte de forme a la connexion : la regle de longueur ne
	// s'applique qu'a la definition d'un mot de passe. Verifier ici ferait
	// fuiter l'information "ce mot de passe ne peut pas exister".
	@IsString()
	@MaxLength(200)
	password!: string;
}

/**
 * Code du second facteur.
 *
 * Aucune contrainte de forme au-dela d'une longueur raisonnable : le champ
 * accepte indifferemment un code temporel a six chiffres et un code de secours,
 * et c'est le service qui distingue les deux. Contraindre la forme ici dirait a
 * l'appelant lequel des deux il vient de saisir.
 */
export class TwoFactorCodeDto {
	@IsString()
	@MinLength(6)
	@MaxLength(32)
	code!: string;
}

export class TwoFactorLoginDto extends TwoFactorCodeDto {
	@IsString()
	@MaxLength(2048)
	challengeToken!: string;
}

export class DisableTwoFactorDto extends TwoFactorCodeDto {
	@IsString()
	@MaxLength(200)
	password!: string;
}

export class ChangePasswordDto {
	@IsString()
	@MaxLength(200)
	currentPassword!: string;

	@IsString()
	@MinLength(PASSWORD_MIN_LENGTH, {
		message: `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.`,
	})
	@MaxLength(200)
	newPassword!: string;
}
