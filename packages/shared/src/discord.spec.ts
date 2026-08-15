import {
	isSnowflake,
	roleColorToHex,
	snowflakeToDate,
} from "./discord";

describe("snowflakeToDate", () => {
	it("deduit la date de creation depuis le snowflake", () => {
		expect(snowflakeToDate("250902879667879937").toISOString()).toBe(
			"2016-11-23T08:38:28.062Z",
		);
	});
});

describe("isSnowflake", () => {
	it("accepte un identifiant de 17 a 20 chiffres", () => {
		expect(isSnowflake("250902879667879937")).toBe(true);
		expect(isSnowflake("12345678901234567")).toBe(true);
	});

	it("rejette ce qui n'est pas un snowflake valide", () => {
		expect(isSnowflake("not-an-id")).toBe(false);
		expect(isSnowflake("123")).toBe(false);
		expect(isSnowflake("")).toBe(false);
	});
});

describe("roleColorToHex", () => {
	it("renvoie null pour la couleur par defaut (0)", () => {
		expect(roleColorToHex(0)).toBeNull();
	});

	it("convertit un entier en hexadecimal CSS sur 6 chiffres", () => {
		expect(roleColorToHex(16711680)).toBe("#ff0000");
		expect(roleColorToHex(255)).toBe("#0000ff");
	});
});
