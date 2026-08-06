import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  username: string;
}

export interface IssuedRefreshToken {
  /** Valeur en clair, posee en cookie et jamais stockee. */
  token: string;
  expiresAt: Date;
}

/**
 * Gestion des jetons.
 *
 * L'access token est un JWT court, garde en memoire par le dashboard. Le
 * refresh token est une valeur aleatoire opaque, stockee hachee en base et
 * transmise uniquement par cookie httpOnly — donc hors de portee d'un XSS.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<{ app: AppConfig }, true>,
  ) {}

  private get appConfig(): AppConfig {
    return this.config.get('app', { infer: true });
  }

  /**
   * SHA-256 et non argon2 : le refresh token est deja une valeur aleatoire de
   * 256 bits, il n'y a rien a bruteforcer, et un hachage rapide permet de
   * retrouver la ligne par index.
   */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  signAccessToken(userId: string, username: string): string {
    return this.jwt.sign(
      { sub: userId, username } satisfies AccessTokenPayload,
      {
        secret: this.appConfig.jwt.accessSecret,
        // En secondes plutot qu'en chaine ("15m") : la forme numerique est sans
        // ambiguite, et c'est la meme valeur que celle annoncee au client.
        expiresIn: this.accessTokenTtlSeconds(),
      },
    );
  }

  /** Duree de vie de l'access token en secondes, pour l'annoncer au client. */
  accessTokenTtlSeconds(): number {
    const ttl = this.appConfig.jwt.accessTtl;
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;

    const value = Number(match[1]);
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multipliers[match[2]!] ?? 60);
  }

  async issueRefreshToken(
    appUserId: string,
    context: { familyId?: string; userAgent?: string; ip?: string },
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.appConfig.jwt.refreshTtlDays * 86_400_000,
    );

    await this.prisma.refreshToken.create({
      data: {
        appUserId,
        tokenHash: this.hash(token),
        familyId: context.familyId ?? randomUUID(),
        expiresAt,
        userAgent: context.userAgent?.slice(0, 255) ?? null,
        ip: context.ip ?? null,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Fait tourner un refresh token.
   *
   * Un jeton deja revoque qui revient signifie qu'il a ete rejoue : soit un vol,
   * soit une copie. On ne peut pas distinguer le voleur du proprietaire, donc on
   * revoque toute la famille et on force une reconnexion.
   */
  async rotateRefreshToken(
    token: string,
    context: { userAgent?: string; ip?: string },
  ): Promise<{ appUserId: string; refresh: IssuedRefreshToken } | null> {
    const tokenHash = this.hash(token);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { appUser: { select: { id: true, isActive: true } } },
    });

    if (!stored) return null;

    if (stored.revokedAt) {
      this.logger.warn(
        `Refresh token rejoue pour le compte ${stored.appUserId} : revocation de la famille ${stored.familyId}.`,
      );
      await this.revokeFamily(stored.familyId);
      return null;
    }

    if (stored.expiresAt.getTime() < Date.now()) return null;
    if (!stored.appUser.isActive) return null;

    const refresh = await this.issueRefreshToken(stored.appUserId, {
      familyId: stored.familyId,
      userAgent: context.userAgent,
      ip: context.ip,
    });

    const replacement = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(refresh.token) },
      select: { id: true },
    });

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: replacement?.id ?? null },
    });

    return { appUserId: stored.appUserId, refresh };
  }

  async revokeToken(token: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Deconnecte le compte de partout (changement de mot de passe, desactivation). */
  async revokeAllForUser(appUserId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { appUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Purge les jetons expires depuis plus de 30 jours. */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return count;
  }
}
