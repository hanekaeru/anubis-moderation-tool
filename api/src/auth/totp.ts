import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238), ecrit ici plutot qu'importe.
 *
 * L'algorithme tient en trente lignes et se verifie contre les vecteurs de
 * test de la RFC (`totp.spec.ts`) : ajouter une dependance pour cela reviendrait
 * a confier l'authentification a du code qu'on ne relit jamais, pour une
 * economie nulle. Les parametres sont ceux que toutes les applications
 * d'authentification supposent par defaut — SHA-1, 6 chiffres, pas de 30
 * secondes — et en changer casserait Google Authenticator, Aegis ou 1Password
 * sans prevenir : ce ne sont pas des reglages, ce sont des constantes.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;
const ALGORITHM = "sha1";

/**
 * Tolerance, en pas de 30 secondes, de part et d'autre de l'instant courant.
 *
 * Une fenetre de ±1 accepte un telephone desynchronise d'une demi-minute, ce
 * qui est frequent. L'elargir multiplierait d'autant la surface d'un code
 * devine ; la reduire a zero ferait echouer des codes legitimes.
 */
const DEFAULT_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Secret aleatoire de 160 bits, la taille recommandee par la RFC 4226. */
export function generateTotpSecret(): string {
	return encodeBase32(randomBytes(20));
}

export function encodeBase32(buffer: Buffer): string {
	let bits = 0;
	let value = 0;
	let output = "";

	for (const byte of buffer) {
		value = (value << 8) | byte;
		bits += 8;

		while (bits >= 5) {
			output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}

	if (bits > 0) {
		output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	}

	return output;
}

/**
 * Decode un secret base32.
 *
 * Le remplissage `=` et les espaces sont ignores : les applications
 * d'authentification affichent volontiers le secret par groupes de quatre, et
 * un utilisateur qui le recopie a la main les recopie avec.
 */
export function decodeBase32(secret: string): Buffer {
	const normalized = secret.toUpperCase().replace(/[\s=]/g, "");
	let bits = 0;
	let value = 0;
	const bytes: number[] = [];

	for (const character of normalized) {
		const index = BASE32_ALPHABET.indexOf(character);
		if (index === -1) {
			throw new Error(`Caractère base32 invalide : ${character}`);
		}

		value = (value << 5) | index;
		bits += 5;

		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}

	return Buffer.from(bytes);
}

/** Code HOTP (RFC 4226) pour un compteur donne. */
function hotp(secret: Buffer, counter: number): string {
	const buffer = Buffer.alloc(8);
	// Compteur sur 64 bits big-endian. `writeBigUInt64BE` plutot qu'un
	// decoupage a la main : au-dela de 2^32 secondes, un `writeUInt32BE` sur la
	// moitie basse deborderait silencieusement.
	buffer.writeBigUInt64BE(BigInt(counter));

	const digest = createHmac(ALGORITHM, secret).update(buffer).digest();

	// Troncature dynamique : les quatre bits de poids faible du dernier octet
	// designent l'offset de lecture.
	const offset = digest[digest.length - 1]! & 0x0f;
	const binary =
		((digest[offset]! & 0x7f) << 24) |
		((digest[offset + 1]! & 0xff) << 16) |
		((digest[offset + 2]! & 0xff) << 8) |
		(digest[offset + 3]! & 0xff);

	return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** Code attendu a un instant donne (par defaut, maintenant). */
export function generateTotp(secret: string, at: Date = new Date()): string {
	return hotp(decodeBase32(secret), Math.floor(at.getTime() / 1000 / PERIOD_SECONDS));
}

/**
 * Verifie un code et renvoie le pas de temps auquel il correspond, ou `null`.
 *
 * Le pas est rendu pour que l'appelant puisse le retenir et refuser une
 * seconde presentation du meme code : sans cela, un code intercepte reste
 * valable pendant toute la fenetre de tolerance.
 *
 * La comparaison est a temps constant : un `===` sur des chaines s'arrete au
 * premier caractere different, ce qui laisse fuir, code par code, la valeur
 * attendue a qui sait mesurer. Six chiffres se devineraient alors bien plus
 * vite que par force brute.
 */
export function verifyTotpCounter(
	secret: string,
	code: string,
	options: { at?: Date; window?: number } = {},
): number | null {
	const cleaned = code.replace(/\s/g, "");
	if (!/^\d+$/.test(cleaned) || cleaned.length !== DIGITS) return null;

	const at = options.at ?? new Date();
	const window = options.window ?? DEFAULT_WINDOW;
	const counter = Math.floor(at.getTime() / 1000 / PERIOD_SECONDS);

	let key: Buffer;
	try {
		key = decodeBase32(secret);
	} catch {
		return null;
	}

	const candidate = Buffer.from(cleaned);
	let matched: number | null = null;

	// La boucle ne s'interrompt pas au premier succes : sortir plus tot pour un
	// code du pas courant que pour un code du pas precedent redonnerait
	// exactement l'information que la comparaison a temps constant protege.
	for (let drift = -window; drift <= window; drift += 1) {
		const expected = Buffer.from(hotp(key, counter + drift));
		if (
			expected.length === candidate.length &&
			timingSafeEqual(expected, candidate)
		) {
			matched = counter + drift;
		}
	}

	return matched;
}

export function verifyTotp(
	secret: string,
	code: string,
	options: { at?: Date; window?: number } = {},
): boolean {
	return verifyTotpCounter(secret, code, options) !== null;
}

/**
 * URI `otpauth://` a encoder dans le QR code.
 *
 * L'emetteur apparait deux fois — dans le chemin et en parametre — parce que
 * les applications d'authentification ne lisent pas toutes le meme : sans le
 * parametre, certaines affichent le compte sans dire de quel service il vient.
 */
export function buildOtpauthUri(options: {
	secret: string;
	account: string;
	issuer: string;
}): string {
	const label = encodeURIComponent(`${options.issuer}:${options.account}`);
	const params = new URLSearchParams({
		secret: options.secret,
		issuer: options.issuer,
		algorithm: ALGORITHM.toUpperCase(),
		digits: String(DIGITS),
		period: String(PERIOD_SECONDS),
	});

	return `otpauth://totp/${label}?${params.toString()}`;
}
