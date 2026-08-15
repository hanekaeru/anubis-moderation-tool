import { Snowflake } from "./dto/common";

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
