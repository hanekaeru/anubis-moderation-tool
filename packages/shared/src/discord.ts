import { Snowflake } from "./dto/common";

/** Date de creation d'un compte, deduite du snowflake. */
export function snowflakeToDate(id: Snowflake): Date {
	const DISCORD_EPOCH = 1420070400000n;
	return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

/**
 * Un identifiant Discord : 17 a 20 chiffres, rien d'autre.
 *
 * Exporte pour que le dashboard valide la saisie avec la meme regle que l'API,
 * qui seule fait foi. Pas de drapeau `g` : l'expression est partagee, et
 * `lastIndex` ferait echouer un test sur deux.
 */
export const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export function isSnowflake(value: string): boolean {
	return SNOWFLAKE_PATTERN.test(value);
}

/** Couleur Discord (entier) vers hexadecimal CSS. */
export function roleColorToHex(color: number): string | null {
	if (!color) return null;
	return `#${color.toString(16).padStart(6, "0")}`;
}
