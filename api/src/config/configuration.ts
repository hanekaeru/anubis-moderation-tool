/**
 * Configuration typee, validee une fois au demarrage.
 *
 * Le principe : si une variable indispensable manque, l'API refuse de demarrer
 * avec un message clair, plutot que d'echouer plus tard sur un `undefined`.
 */

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  port: number;
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
      `Configuration incomplete. Variables manquantes : ${keys.join(', ')}.\n` +
        'Copier api/.env.example en api/.env et renseigner ces valeurs.',
    );
    this.name = 'MissingConfigError';
  }
}

function required(env: NodeJS.ProcessEnv, keys: string[]): void {
  const missing = keys.filter((key) => !env[key]?.trim());
  if (missing.length) throw new MissingConfigError(missing);
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

export function loadConfiguration(): AppConfig {
  const env = process.env;

  required(env, [
    'DATABASE_URL',
    'GUILD_ID',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
  ]);

  const accessSecret = env.JWT_ACCESS_SECRET!;
  const refreshSecret = env.JWT_REFRESH_SECRET!;

  if (accessSecret === refreshSecret) {
    throw new Error(
      'JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent etre differents : ' +
        'un secret partage permettrait de forger un access token a partir d un refresh token.',
    );
  }

  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  const isProduction = nodeEnv === 'production';

  if (isProduction && accessSecret.length < 32) {
    throw new Error(
      'JWT_ACCESS_SECRET doit faire au moins 32 caracteres en production.',
    );
  }

  return {
    nodeEnv,
    isProduction,
    port: toInt(env.PORT, 3000),
    databaseUrl: env.DATABASE_URL!,
    guildId: env.GUILD_ID!,
    jwt: {
      accessSecret,
      refreshSecret,
      accessTtl: env.ACCESS_TOKEN_TTL ?? '15m',
      refreshTtlDays: toInt(env.REFRESH_TOKEN_TTL_DAYS, 7),
    },
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:4200')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    cookieSecure: toBool(env.COOKIE_SECURE, isProduction),
    security: {
      maxFailedLogins: toInt(env.MAX_FAILED_LOGINS, 5),
      lockoutMinutes: toInt(env.LOCKOUT_MINUTES, 15),
    },
  };
}
