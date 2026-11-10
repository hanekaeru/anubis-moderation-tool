import { createHmac } from "node:crypto";

/**
 * Empreinte d'un compte Blizzard : HMAC-SHA256 du `sub` OAuth sous
 * `BATTLENET_ID_SECRET`, en hexadecimal.
 *
 * Un HMAC et non un simple SHA-256 : les `sub` Blizzard sont des entiers, assez
 * peu nombreux pour qu'une table de hachage complete se calcule. Sans la clef,
 * une base qui fuiterait ne permettrait pas de retrouver les comptes Blizzard —
 * meme raisonnement que le hachage des refresh tokens.
 */
export function hashBattlenetId(secret: string, sub: string): string {
	return createHmac("sha256", secret).update(sub).digest("hex");
}

/**
 * Forme d'une empreinte. Un `sub` Blizzard est numerique : il ne peut pas s'y
 * conformer, ce qui permet de reconnaitre les lignes ecrites avant le passage
 * aux empreintes.
 */
export const BATTLENET_HASH_PATTERN = /^[0-9a-f]{64}$/;
