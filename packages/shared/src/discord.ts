import { Snowflake } from "./dto/common";

const CDN = "https://cdn.discordapp.com";

/**
 * URL d'avatar d'un compte Discord. Retombe sur l'avatar par defaut quand le
 * membre n'en a pas defini, pour que l'interface n'ait jamais de trou.
 */
export function avatarUrl(
	userId: Snowflake,
	avatarHash: string | null | undefined,
	size = 128,
): string {
	if (!avatarHash) {
		// Depuis le passage aux pseudos uniques, l'avatar par defaut derive de
		// l'identifiant : (id >> 22) % 6.
		const index = Number((BigInt(userId) >> 22n) % 6n);
		return `${CDN}/embed/avatars/${index}.png`;
	}
	const extension = avatarHash.startsWith("a_") ? "gif" : "png";
	return `${CDN}/avatars/${userId}/${avatarHash}.${extension}?size=${size}`;
}

/** Date de creation d'un compte, deduite du snowflake. */
export function snowflakeToDate(id: Snowflake): Date {
	const DISCORD_EPOCH = 1420070400000n;
	return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export function isSnowflake(value: string): boolean {
	return SNOWFLAKE_PATTERN.test(value);
}

/** Couleur Discord (entier) vers hexadecimal CSS. */
export function roleColorToHex(color: number): string | null {
	if (!color) return null;
	return `#${color.toString(16).padStart(6, "0")}`;
}
