import {
	buildOtpauthUri,
	decodeBase32,
	encodeBase32,
	generateTotp,
	generateTotpSecret,
	verifyTotp,
} from "./totp";

/**
 * Vecteurs de test de la RFC 6238, appendice B.
 *
 * Le secret y est donne en ASCII (`"12345678901234567890"`) ; il est converti
 * en base32 ici, puisque c'est la forme que stocke la base et que lisent les
 * applications d'authentification. Ces valeurs sont ce qui prouve que
 * l'implementation est la bonne : sans elles, un code faux mais coherent avec
 * lui-meme passerait tous les autres tests.
 */
const RFC_SECRET = encodeBase32(Buffer.from("12345678901234567890", "ascii"));

const RFC_VECTORS: { seconds: number; code: string }[] = [
	{ seconds: 59, code: "287082" },
	{ seconds: 1_111_111_109, code: "081804" },
	{ seconds: 1_111_111_111, code: "050471" },
	{ seconds: 1_234_567_890, code: "005924" },
	{ seconds: 2_000_000_000, code: "279037" },
];

describe("base32", () => {
	it("fait l'aller-retour sans perte", () => {
		const source = Buffer.from("Anubis, secret de test", "utf8");
		expect(decodeBase32(encodeBase32(source))).toEqual(source);
	});

	it("ignore le remplissage et les espaces d'un secret recopie a la main", () => {
		const secret = encodeBase32(Buffer.from("12345678901234567890", "ascii"));
		const spaced = secret.replace(/(.{4})/g, "$1 ").trim().toLowerCase();

		expect(decodeBase32(spaced)).toEqual(decodeBase32(secret));
	});
});

describe("generateTotp", () => {
	it.each(RFC_VECTORS)(
		"reproduit le vecteur RFC 6238 a t=$seconds",
		({ seconds, code }) => {
			expect(generateTotp(RFC_SECRET, new Date(seconds * 1000))).toBe(code);
		},
	);
});

describe("verifyTotp", () => {
	const at = new Date(1_234_567_890 * 1000);

	it("accepte le code du pas courant", () => {
		expect(verifyTotp(RFC_SECRET, "005924", { at })).toBe(true);
	});

	it("accepte un telephone en retard ou en avance d'un pas", () => {
		const previous = generateTotp(RFC_SECRET, new Date(at.getTime() - 30_000));
		const next = generateTotp(RFC_SECRET, new Date(at.getTime() + 30_000));

		expect(verifyTotp(RFC_SECRET, previous, { at })).toBe(true);
		expect(verifyTotp(RFC_SECRET, next, { at })).toBe(true);
	});

	it("refuse au-dela de la tolerance", () => {
		const distant = generateTotp(RFC_SECRET, new Date(at.getTime() + 120_000));
		expect(verifyTotp(RFC_SECRET, distant, { at })).toBe(false);
	});

	it("refuse ce qui n'est pas six chiffres", () => {
		expect(verifyTotp(RFC_SECRET, "", { at })).toBe(false);
		expect(verifyTotp(RFC_SECRET, "12345", { at })).toBe(false);
		expect(verifyTotp(RFC_SECRET, "0059240", { at })).toBe(false);
		expect(verifyTotp(RFC_SECRET, "abcdef", { at })).toBe(false);
	});

	// Un secret illisible ne doit pas faire tomber la route de connexion : la
	// seule reponse correcte est un refus.
	it("refuse sans lever quand le secret est corrompu", () => {
		expect(verifyTotp("pas-du-base32-!", "005924", { at })).toBe(false);
	});
});

describe("generateTotpSecret", () => {
	it("produit un secret de 160 bits, verifiable de bout en bout", () => {
		const secret = generateTotpSecret();

		expect(decodeBase32(secret)).toHaveLength(20);
		expect(verifyTotp(secret, generateTotp(secret))).toBe(true);
	});
});

describe("buildOtpauthUri", () => {
	it("porte l'emetteur dans le libelle et en parametre", () => {
		const uri = buildOtpauthUri({
			secret: "ABCDEFGH",
			account: "moderateur",
			issuer: "Anubis",
		});

		expect(uri).toContain("otpauth://totp/Anubis%3Amoderateur?");
		expect(uri).toContain("issuer=Anubis");
		expect(uri).toContain("secret=ABCDEFGH");
		expect(uri).toContain("digits=6");
		expect(uri).toContain("period=30");
	});
});
