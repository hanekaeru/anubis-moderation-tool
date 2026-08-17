import * as argon2 from "argon2";

/**
 * Hachage des secrets longue duree : mots de passe et codes de secours.
 *
 * Isole de `AuthService` parce que `TwoFactorService` en a besoin et que
 * `AuthService` depend de `TwoFactorService` : passer par la classe creerait un
 * cycle d'imports entre les deux services. Les parametres sont ceux de la
 * configuration initiale — les changer reviendrait a invalider les empreintes
 * deja en base, qui ne se recalculent qu'a la prochaine saisie du secret.
 */
export const ARGON2_OPTIONS: argon2.Options = {
	type: argon2.argon2id,
	memoryCost: 65536,
	timeCost: 3,
	parallelism: 4,
};

export function hashSecret(secret: string): Promise<string> {
	return argon2.hash(secret, ARGON2_OPTIONS);
}

/**
 * Verifie une empreinte sans jamais lever.
 *
 * Une empreinte corrompue en base doit se traduire par un refus, pas par une
 * erreur 500 : l'appelant est toujours un chemin d'authentification.
 */
export function verifySecret(hash: string, secret: string): Promise<boolean> {
	return argon2.verify(hash, secret).catch(() => false);
}
