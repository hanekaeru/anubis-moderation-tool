import {
	avatarUrl,
	isSnowflake,
	roleColorToHex,
	snowflakeToDate,
} from "./discord";

describe("avatarUrl", () => {
	it("renvoie un png quand le hash n'est pas anime", () => {
		expect(avatarUrl("250902879667879937", "abcdef123456")).toBe(
			"https://cdn.discordapp.com/avatars/250902879667879937/abcdef123456.png?size=128",
		);
	});

	it("renvoie un gif quand le hash commence par a_ (avatar anime)", () => {
		expect(avatarUrl("250902879667879937", "a_abcdef123456")).toBe(
			"https://cdn.discordapp.com/avatars/250902879667879937/a_abcdef123456.gif?size=128",
		);
	});

	it("permet de demander explicitement un webp pour un avatar anime", () => {
		expect(
			avatarUrl("250902879667879937", "a_abcdef123456", 128, "webp"),
		).toBe(
			"https://cdn.discordapp.com/avatars/250902879667879937/a_abcdef123456.webp?size=128",
		);
	});

	it("repercute la taille demandee dans l'URL", () => {
		expect(avatarUrl("250902879667879937", "abcdef123456", 256)).toContain(
			"size=256",
		);
	});

	it("retombe sur l'avatar par defaut derive de l'identifiant, sans hash", () => {
		expect(avatarUrl("250902879667879937", null)).toBe(
			"https://cdn.discordapp.com/embed/avatars/0.png",
		);
		expect(avatarUrl("80351110224678912", undefined)).toBe(
			"https://cdn.discordapp.com/embed/avatars/5.png",
		);
	});
});

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
