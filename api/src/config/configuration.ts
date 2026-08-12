/**
 * Configuration typee, validee une fois au demarrage.
 *
 * Le principe : si une variable indispensable manque, l'API refuse de demarrer
 * avec un message clair, plutot que d'echouer plus tard sur un `undefined`.
 */

export interface AppConfig {
	nodeEnv: "development" | "production" | "test";
	isProduction: boolean;
	port: number;
	/**
	 * Prefixe applique a toutes les routes. Vide = aucun prefixe.
	 *
	 * Derriere un reverse proxy qui route par chemin (`/api` -> ce conteneur),
	 * le proxy retire lui-meme le prefixe avant de transmettre. L'API le
	 * remettrait alors une seconde fois et repondrait 404 sur tout.
	 */
	globalPrefix: string;
	databaseUrl: string;
	guildId: string;
	jwt: {
		accessSecret: string;
		refreshSecret: string;
		accessTtl: string;
		refreshTtlDays: number;
	};
	corsOrigins: string[];
	cookieSecure: boolean;
	security: {
		maxFailedLogins: number;
		lockoutMinutes: number;
	};
}

class MissingConfigError extends Error {
	constructor(keys: string[]) {
		super(
			`Configuration incomplete. Variables manquantes : ${keys.join(", ")}.\n` +
				"Copier api/.env.example en api/.env et renseigner ces valeurs.",
		);
		this.name = "MissingConfigError";
	}
}

function required(env: NodeJS.ProcessEnv, keys: string[]): void {
	const missing = keys.filter((key) => !env[key]?.trim());
	if (missing.length) throw new MissingConfigError(missing);
}

/**
 * Entier strictement positif, sinon la valeur de repli.
 *
 * Accepter zero ou un negatif ouvrait des comportements absurdes et silencieux :
 * `MAX_FAILED_LOGINS=0` verrouillait le compte des le premier echec (le test
 * `echecs >= 0` etant toujours vrai), et un TTL negatif delivrait des jetons
 * deja expires.
 */
function toInt(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	return value.toLowerCase() === "true" || value === "1";
}

export function loadConfiguration(): AppConfig {
	const env = process.env;

	required(env, [
		"DATABASE_URL",
		"GUILD_ID",
		"JWT_ACCESS_SECRET",
		"JWT_REFRESH_SECRET",
	]);

	const accessSecret = env.JWT_ACCESS_SECRET!;
	const refreshSecret = env.JWT_REFRESH_SECRET!;

	if (accessSecret === refreshSecret) {
		throw new Error(
			"JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent etre differents : " +
				"un secret partage permettrait de forger un access token a partir d un refresh token.",
		);
	}

	const nodeEnv = (env.NODE_ENV ?? "development") as AppConfig["nodeEnv"];
	const isProduction = nodeEnv === "production";

	if (isProduction) {
		// Les deux secrets sont utilises : l'un signe les access tokens, l'autre
		// sert de clef HMAC aux refresh tokens. Les deux meritent la meme exigence.
		for (const [nom, valeur] of [
			["JWT_ACCESS_SECRET", accessSecret],
			["JWT_REFRESH_SECRET", refreshSecret],
		] as const) {
			if (valeur.length < 32) {
				throw new Error(
					`${nom} doit faire au moins 32 caracteres en production.`,
				);
			}
		}
	}

	return {
		nodeEnv,
		isProduction,
		port: toInt(env.PORT, 3000),
		// `??` et non `||` : la chaine vide est une valeur voulue (aucun prefixe),
		// seule une variable absente retombe sur la valeur par defaut.
		globalPrefix: (env.API_GLOBAL_PREFIX ?? "api").replace(
			/^\/+|\/+$/g,
			"",
		),
		databaseUrl: env.DATABASE_URL!,
		guildId: env.GUILD_ID!,
		jwt: {
			accessSecret,
			refreshSecret,
			accessTtl: env.ACCESS_TOKEN_TTL ?? "15m",
			refreshTtlDays: toInt(env.REFRESH_TOKEN_TTL_DAYS, 7),
		},
		corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:4200")
			.split(",")
			.map((origin) => origin.trim())
			.filter(Boolean),
		cookieSecure: toBool(env.COOKIE_SECURE, isProduction),
		security: {
			maxFailedLogins: toInt(env.MAX_FAILED_LOGINS, 5),
			lockoutMinutes: toInt(env.LOCKOUT_MINUTES, 15),
		},
	};
}
