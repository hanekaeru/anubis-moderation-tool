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

export class ChangePasswordDto {
	@IsString()
	@MaxLength(200)
	currentPassword!: string;

	@IsString()
	@MinLength(PASSWORD_MIN_LENGTH, {
		message: `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caracteres.`,
	})
	@MaxLength(200)
	newPassword!: string;
}
