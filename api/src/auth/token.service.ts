import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { AppConfig } from "../config/configuration";
import { PrismaService } from "../prisma/prisma.service";

export interface AccessTokenPayload {
	sub: string;
	username: string;
	/**
	 * Famille de refresh tokens dont ce jeton est issu — l'identifiant de la
	 * session. Le cookie de refresh etant limite au chemin `/api/auth`, c'est la
	 * seule facon pour une autre route de savoir de quelle session elle est
	 * appelee. Facultatif : les jetons emis avant son ajout n'en portent pas.
	 */
	sid?: string;
}

/**
 * Charge du jeton de defi remis entre les deux facteurs.
 *
 * Il ne porte volontairement pas `username` : ce n'est pas une identite
 * utilisable, seulement la preuve qu'un mot de passe correct vient d'etre
 * presente pour ce compte.
 */
export interface ChallengeTokenPayload {
	sub: string;
	purpose: "2fa";
}

/**
 * Duree de vie du defi de second facteur, en secondes.
 *
 * Assez pour deverrouiller un telephone et lire un code, trop peu pour qu'un
 * jeton oublie dans un journal serve encore a quelque chose.
 */
const CHALLENGE_TTL_SECONDS = 300;

export interface IssuedRefreshToken {
	/** Valeur en clair, posee en cookie et jamais stockee. */
	token: string;
	expiresAt: Date;
	/** Famille, c'est-a-dire la session : stable a travers les rotations. */
	familyId: string;
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
		return this.config.get("app", { infer: true });
	}

	/**
	 * HMAC-SHA256 et non argon2 : le refresh token est deja une valeur aleatoire
	 * de 256 bits, il n'y a rien a bruteforcer, et un hachage rapide permet de
	 * retrouver la ligne par index.
	 *
	 * La clef est `JWT_REFRESH_SECRET`, qui sert enfin a quelque chose : avec un
	 * SHA-256 nu, quiconque obtient une copie de la base peut verifier hors ligne
	 * si un jeton devine correspond a une ligne. Le secret, lui, ne se trouve pas
	 * dans la base.
	 */
	private hash(token: string): string {
		return createHmac("sha256", this.appConfig.jwt.refreshSecret)
			.update(token)
			.digest("hex");
	}

	signAccessToken(userId: string, username: string, sessionId?: string): string {
		return this.jwt.sign(
			{ sub: userId, username, sid: sessionId } satisfies AccessTokenPayload,
			{
				secret: this.appConfig.jwt.accessSecret,
				// En secondes plutot qu'en chaine ("15m") : la forme numerique est sans
				// ambiguite, et c'est la meme valeur que celle annoncee au client.
				expiresIn: this.accessTokenTtlSeconds(),
			},
		);
	}

	/**
	 * Secret du jeton de defi.
	 *
	 * **Different de celui des access tokens**, et derive plutot que configure :
	 * signe avec le secret d'acces, un defi passerait la strategie JWT et
	 * ouvrirait toute l'API sans que le second facteur ait ete presente — le
	 * garde n'y verrait qu'un `sub` valide. Le derivant du secret de refresh, il
	 * suit son cycle de vie : le faire tourner invalide aussi les defis en cours.
	 */
	private get challengeSecret(): string {
		return createHmac("sha256", this.appConfig.jwt.refreshSecret)
			.update("anubis:2fa-challenge")
			.digest("hex");
	}

	/** Jeton remis apres un mot de passe correct, en attente du second facteur. */
	signChallengeToken(userId: string): { token: string; expiresIn: number } {
		return {
			token: this.jwt.sign({ sub: userId, purpose: "2fa" } satisfies ChallengeTokenPayload, {
				secret: this.challengeSecret,
				expiresIn: CHALLENGE_TTL_SECONDS,
			}),
			expiresIn: CHALLENGE_TTL_SECONDS,
		};
	}

	/** Identifiant du compte porte par un defi valide, ou `null`. */
	verifyChallengeToken(token: string): string | null {
		try {
			const payload = this.jwt.verify<ChallengeTokenPayload>(token, {
				secret: this.challengeSecret,
			});

			return payload.purpose === "2fa" ? payload.sub : null;
		} catch {
			return null;
		}
	}

	/** Duree de vie de l'access token en secondes, pour l'annoncer au client. */
	accessTokenTtlSeconds(): number {
		const ttl = this.appConfig.jwt.accessTtl;
		const match = /^(\d+)([smhd])$/.exec(ttl);
		if (!match) return 900;

		const value = Number(match[1]);
		const multipliers: Record<string, number> = {
			s: 1,
			m: 60,
			h: 3600,
			d: 86400,
		};
		return value * (multipliers[match[2]!] ?? 60);
	}

	async issueRefreshToken(
		appUserId: string,
		context: { familyId?: string; userAgent?: string; ip?: string },
	): Promise<IssuedRefreshToken> {
		const token = randomBytes(48).toString("base64url");
		const expiresAt = new Date(
			Date.now() + this.appConfig.jwt.refreshTtlDays * 86_400_000,
		);
		const familyId = context.familyId ?? randomUUID();

		await this.prisma.refreshToken.create({
			data: {
				appUserId,
				tokenHash: this.hash(token),
				familyId,
				expiresAt,
				userAgent: context.userAgent?.slice(0, 255) ?? null,
				ip: context.ip ?? null,
			},
		});

		return { token, expiresAt, familyId };
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
				`Refresh token rejoué pour le compte ${stored.appUserId} : révocation de la famille ${stored.familyId}.`,
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
			data: {
				revokedAt: new Date(),
				replacedById: replacement?.id ?? null,
			},
		});

		return { appUserId: stored.appUserId, refresh };
	}

	/**
	 * Revoque un jeton et renvoie le compte auquel il appartenait.
	 *
	 * La deconnexion est une route publique — le garde JWT ne peuple donc pas
	 * `request.user` — et le cookie est la seule preuve d'identite disponible.
	 * Sans ce retour, le journal d'audit ne saurait jamais qui s'est deconnecte.
	 */
	async revokeToken(token: string): Promise<string | null> {
		const stored = await this.prisma.refreshToken.findUnique({
			where: { tokenHash: this.hash(token) },
			select: { id: true, appUserId: true, revokedAt: true },
		});

		if (!stored) return null;

		if (!stored.revokedAt) {
			await this.prisma.refreshToken.update({
				where: { id: stored.id },
				data: { revokedAt: new Date() },
			});
		}

		return stored.appUserId;
	}

	/**
	 * Famille a laquelle appartient un jeton en clair, ou `null`.
	 *
	 * Sert a la page « Sessions actives » pour reperer la session depuis
	 * laquelle elle est consultee : sans ce reperage, se couper soi-meme en
	 * croyant fermer une session etrangere serait l'erreur la plus facile a
	 * commettre. Le hachage reste interne au service — le cookie ne sort pas
	 * d'ici.
	 */
	async familyForToken(token: string): Promise<string | null> {
		const stored = await this.prisma.refreshToken.findUnique({
			where: { tokenHash: this.hash(token) },
			select: { familyId: true },
		});

		return stored?.familyId ?? null;
	}

	async revokeFamily(familyId: string): Promise<number> {
		const { count } = await this.prisma.refreshToken.updateMany({
			where: { familyId, revokedAt: null },
			data: { revokedAt: new Date() },
		});

		return count;
	}

	/** Deconnecte le compte de partout (changement de mot de passe, desactivation). */
	async revokeAllForUser(appUserId: string): Promise<number> {
		const { count } = await this.prisma.refreshToken.updateMany({
			where: { appUserId, revokedAt: null },
			data: { revokedAt: new Date() },
		});

		return count;
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
