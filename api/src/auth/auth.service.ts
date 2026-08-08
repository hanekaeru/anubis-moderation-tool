import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import {
  permissionsForRole,
  type AppUserRole,
  type SessionUser,
} from '@anubis/shared';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TokenService } from './token.service';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Hash reel d'une valeur aleatoire, calcule une seule fois. Sert a consommer
   * le meme temps CPU qu'une verification legitime quand l'identifiant n'existe
   * pas — sans quoi la duree de la reponse revelerait quels comptes existent.
   */
  private readonly dummyHash: Promise<string> = argon2.hash(
    randomBytes(32).toString('hex'),
    ARGON2_OPTIONS,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<{ app: AppConfig }, true>,
  ) {}

  private get security() {
    return this.config.get('app', { infer: true }).security;
  }

  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  /**
   * Verifie les identifiants.
   *
   * Toutes les causes d'echec renvoient le meme message : identifiant inconnu,
   * mot de passe faux ou compte desactive sont indistinguables de l'exterieur.
   * Un hachage factice est calcule quand le compte n'existe pas pour que la
   * duree de la reponse ne trahisse pas son existence.
   */
  async login(
    username: string,
    password: string,
    context: RequestContext,
  ): Promise<{ accessToken: string; expiresIn: number; refreshToken: string; refreshExpiresAt: Date; user: SessionUser }> {
    const account = await this.prisma.appUser.findUnique({
      where: { username },
    });

    if (!account) {
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      throw new UnauthorizedException('Identifiants invalides.');
    }

    const passwordValid = await argon2
      .verify(account.passwordHash, password)
      .catch(() => false);

    if (!passwordValid) {
      await this.registerFailedLogin(account.id, account.failedLoginCount);
      throw new UnauthorizedException('Identifiants invalides.');
    }

    // Verrouillage et desactivation ne sont annonces qu'apres un mot de passe
    // correct. Les annoncer avant permettrait d'enumerer les comptes : cinq
    // tentatives suffiraient a distinguer un identifiant existant (verrouille,
    // message specifique) d'un identifiant inconnu (toujours le meme refus) —
    // ce qui annulerait la mise a niveau du temps de reponse faite plus haut.
    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil(
        (account.lockedUntil.getTime() - Date.now()) / 60_000,
      );
      throw new ForbiddenException(
        `Compte temporairement verrouille. Reessayez dans ${minutes} minute(s).`,
      );
    }

    if (!account.isActive) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    const updated = await this.prisma.appUser.update({
      where: { id: account.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    const refresh = await this.tokens.issueRefreshToken(account.id, context);

    await this.audit.record({
      appUserId: account.id,
      action: 'auth.login',
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return {
      accessToken: this.tokens.signAccessToken(account.id, account.username),
      expiresIn: this.tokens.accessTokenTtlSeconds(),
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
      user: this.toSessionUser(updated),
    };
  }

  private async registerFailedLogin(
    userId: string,
    currentCount: number,
  ): Promise<void> {
    const failed = currentCount + 1;
    const shouldLock = failed >= this.security.maxFailedLogins;

    await this.prisma.appUser.update({
      where: { id: userId },
      data: {
        failedLoginCount: shouldLock ? 0 : failed,
        // `lockedUntil` n'est touche que pour verrouiller. L'ecrire a `null`
        // dans le cas contraire levait le verrou a la tentative suivante : il
        // suffisait d'un mot de passe errone de plus pour rouvrir un compte
        // qui venait d'etre bloque.
        ...(shouldLock
          ? { lockedUntil: new Date(Date.now() + this.security.lockoutMinutes * 60_000) }
          : {}),
      },
    });

    if (shouldLock) {
      this.logger.warn(
        `Compte ${userId} verrouille apres ${failed} echecs de connexion.`,
      );
    }
  }

  async refresh(
    token: string,
    context: RequestContext,
  ): Promise<{ accessToken: string; expiresIn: number; refreshToken: string; refreshExpiresAt: Date; user: SessionUser }> {
    const rotated = await this.tokens.rotateRefreshToken(token, context);

    if (!rotated) {
      throw new UnauthorizedException('Session expiree, reconnexion requise.');
    }

    const account = await this.prisma.appUser.findUnique({
      where: { id: rotated.appUserId },
    });

    if (!account || !account.isActive) {
      throw new UnauthorizedException('Session expiree, reconnexion requise.');
    }

    return {
      accessToken: this.tokens.signAccessToken(account.id, account.username),
      expiresIn: this.tokens.accessTokenTtlSeconds(),
      refreshToken: rotated.refresh.token,
      refreshExpiresAt: rotated.refresh.expiresAt,
      user: this.toSessionUser(account),
    };
  }

  /**
   * Deconnexion.
   *
   * L'identite vient du cookie, pas de `request.user` : la route est publique
   * pour qu'une session deja expiree puisse tout de meme nettoyer son cookie,
   * et le garde JWT n'y renseigne donc jamais l'utilisateur.
   */
  async logout(token: string | undefined, context: RequestContext): Promise<void> {
    if (!token) return;

    const appUserId = await this.tokens.revokeToken(token);
    if (!appUserId) return;

    await this.audit.record({
      appUserId,
      action: 'auth.logout',
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  /**
   * Change le mot de passe et revoque toutes les sessions : un changement de
   * mot de passe doit couper les sessions ouvertes ailleurs, c'est souvent
   * exactement la raison pour laquelle on le change.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<void> {
    const account = await this.prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
    });

    const valid = await argon2
      .verify(account.passwordHash, currentPassword)
      .catch(() => false);

    if (!valid) {
      throw new UnauthorizedException('Mot de passe actuel incorrect.');
    }

    if (await argon2.verify(account.passwordHash, newPassword).catch(() => false)) {
      throw new ForbiddenException(
        'Le nouveau mot de passe doit etre different de l ancien.',
      );
    }

    await this.prisma.appUser.update({
      where: { id: userId },
      data: {
        passwordHash: await AuthService.hashPassword(newPassword),
        mustChangePassword: false,
      },
    });

    await this.tokens.revokeAllForUser(userId);

    await this.audit.record({
      appUserId: userId,
      action: 'auth.password_changed',
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  toSessionUser(account: {
    id: string;
    username: string;
    displayName: string;
    role: AppUserRole;
    mustChangePassword: boolean;
    discordUserId: string | null;
    lastLoginAt: Date | null;
  }): SessionUser {
    return {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      permissions: [...permissionsForRole(account.role)],
      mustChangePassword: account.mustChangePassword,
      discordUserId: account.discordUserId,
      lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
    };
  }
}
