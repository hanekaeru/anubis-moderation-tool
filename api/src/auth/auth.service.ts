import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import type { AppUserRole, SessionUser } from "@anubis/shared";
import type { AppConfig } from "../config/configuration";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RolePermissionsService } from "../role-permissions/role-permissions.service";
import { ARGON2_OPTIONS, hashSecret, verifySecret } from "./password";
import { TokenService } from "./token.service";
import { TwoFactorService } from "./two-factor.service";

export interface RequestContext {
	ip?: string;
	userAgent?: string;
}

/** Session complete : le compte est authentifie, les jetons sont emis. */
export interface IssuedSession {
	accessToken: string;
	expiresIn: number;
	refreshToken: string;
	refreshExpiresAt: Date;
	user: SessionUser;
}

/**
 * Premier facteur valide, second facteur attendu.
 *
 * Aucun jeton de session n'est emis a ce stade : le defi ne prouve que le mot
 * de passe.
 */
export interface PendingSecondFactor {
	twoFactorRequired: true;
	challengeToken: string;
	expiresIn: number;
}

export type LoginOutcome = IssuedSession | PendingSecondFactor;

export function isPendingSecondFactor(
	outcome: LoginOutcome,
): outcome is PendingSecondFactor {
	return (outcome as PendingSecondFactor).twoFactorRequired === true;
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
		randomBytes(32).toString("hex"),
		ARGON2_OPTIONS,
	);

	constructor(
		private readonly prisma: PrismaService,
		private readonly tokens: TokenService,
		private readonly audit: AuditService,
		private readonly config: ConfigService<{ app: AppConfig }, true>,
		private readonly rolePermissions: RolePermissionsService,
		private readonly twoFactor: TwoFactorService,
	) {}

	private get security() {
		return this.config.get("app", { infer: true }).security;
	}

	static hashPassword(password: string): Promise<string> {
		return hashSecret(password);
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
	): Promise<LoginOutcome> {
		const account = await this.prisma.appUser.findUnique({
			where: { username },
		});

		if (!account) {
			await verifySecret(await this.dummyHash, password);
			throw new UnauthorizedException("Identifiants invalides.");
		}

		const passwordValid = await verifySecret(account.passwordHash, password);

		if (!passwordValid) {
			await this.registerFailedLogin(
				account.id,
				account.failedLoginCount,
			);
			throw new UnauthorizedException("Identifiants invalides.");
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
				`Compte temporairement verrouillé. Réessayez dans ${minutes} minute(s).`,
			);
		}

		if (!account.isActive) {
			throw new UnauthorizedException("Identifiants invalides.");
		}

		// Second facteur : aucun jeton de session n'est emis, et `lastLoginAt`
		// n'est pas encore ecrit — la connexion n'a pas eu lieu tant que le code
		// n'a pas ete presente. Le compteur d'echecs est en revanche remis a zero
		// ci-dessous seulement apres le second facteur, pour qu'un bourrage de
		// mots de passe reste freine meme sur un compte protege.
		//
		// `twoFactor.available` court-circuite l'etape quand le deploiement a
		// coupe la double authentification (`TWO_FACTOR_ENABLED=false`) : le
		// secret du compte reste en base, mais il ne protege plus la connexion.
		// C'est tout l'objet de l'interrupteur — et toute sa dangerosite.
		if (account.totpEnabledAt && this.twoFactor.available) {
			const challenge = this.tokens.signChallengeToken(account.id);

			return {
				twoFactorRequired: true,
				challengeToken: challenge.token,
				expiresIn: challenge.expiresIn,
			};
		}

		return this.openSession(account.id, context);
	}

	/**
	 * Second facteur d'une connexion en cours.
	 *
	 * Le defi ne dit que « ce mot de passe etait bon » : tout le reste (compte
	 * encore actif, code valide, code non rejoue) est reverifie ici. Un compte
	 * desactive entre les deux etapes ne doit pas passer.
	 */
	async completeTwoFactorLogin(
		challengeToken: string,
		code: string,
		context: RequestContext,
	): Promise<IssuedSession> {
		const appUserId = this.tokens.verifyChallengeToken(challengeToken);

		if (!appUserId) {
			throw new UnauthorizedException(
				"Vérification expirée : recommencez la connexion.",
			);
		}

		const account = await this.prisma.appUser.findUnique({
			where: { id: appUserId },
			select: { id: true, isActive: true, failedLoginCount: true },
		});

		if (!account || !account.isActive) {
			throw new UnauthorizedException("Identifiants invalides.");
		}

		const valid = await this.twoFactor.verifySecondFactor(appUserId, code);

		if (!valid) {
			// Un code errone compte comme un echec de connexion : sans cela, le
			// second facteur serait le seul endroit de l'API ou l'on peut essayer
			// indefiniment.
			await this.registerFailedLogin(account.id, account.failedLoginCount);
			throw new UnauthorizedException("Code invalide.");
		}

		return this.openSession(account.id, context);
	}

	/** Emet les jetons et journalise la connexion. Commun aux deux parcours. */
	private async openSession(
		appUserId: string,
		context: RequestContext,
	): Promise<IssuedSession> {
		// Le compte est relu par la mise a jour elle-meme : c'est ici que la
		// connexion devient effective, y compris quand un second facteur s'est
		// intercale entre la verification du mot de passe et cet instant.
		const account = await this.prisma.appUser.update({
			where: { id: appUserId },
			data: {
				lastLoginAt: new Date(),
				failedLoginCount: 0,
				lockedUntil: null,
			},
		});

		const refresh = await this.tokens.issueRefreshToken(
			account.id,
			context,
		);

		await this.audit.record({
			appUserId: account.id,
			action: "auth.login",
			ip: context.ip,
			userAgent: context.userAgent,
		});

		return {
			accessToken: this.tokens.signAccessToken(
				account.id,
				account.username,
				refresh.familyId,
			),
			expiresIn: this.tokens.accessTokenTtlSeconds(),
			refreshToken: refresh.token,
			refreshExpiresAt: refresh.expiresAt,
			user: await this.toSessionUser(account),
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
					? {
							lockedUntil: new Date(
								Date.now() +
									this.security.lockoutMinutes * 60_000,
							),
						}
					: {}),
			},
		});

		if (shouldLock) {
			this.logger.warn(
				`Compte ${userId} verrouillé après ${failed} échecs de connexion.`,
			);
		}
	}

	async refresh(
		token: string,
		context: RequestContext,
	): Promise<IssuedSession> {
		const rotated = await this.tokens.rotateRefreshToken(token, context);

		if (!rotated) {
			throw new UnauthorizedException(
				"Session expirée, reconnexion requise.",
			);
		}

		const account = await this.prisma.appUser.findUnique({
			where: { id: rotated.appUserId },
		});

		if (!account || !account.isActive) {
			throw new UnauthorizedException(
				"Session expirée, reconnexion requise.",
			);
		}

		return {
			accessToken: this.tokens.signAccessToken(
				account.id,
				account.username,
				rotated.refresh.familyId,
			),
			expiresIn: this.tokens.accessTokenTtlSeconds(),
			refreshToken: rotated.refresh.token,
			refreshExpiresAt: rotated.refresh.expiresAt,
			user: await this.toSessionUser(account),
		};
	}

	/**
	 * Deconnexion.
	 *
	 * L'identite vient du cookie, pas de `request.user` : la route est publique
	 * pour qu'une session deja expiree puisse tout de meme nettoyer son cookie,
	 * et le garde JWT n'y renseigne donc jamais l'utilisateur.
	 */
	async logout(
		token: string | undefined,
		context: RequestContext,
	): Promise<void> {
		if (!token) return;

		const appUserId = await this.tokens.revokeToken(token);
		if (!appUserId) return;

		await this.audit.record({
			appUserId,
			action: "auth.logout",
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

		const valid = await verifySecret(account.passwordHash, currentPassword);

		if (!valid) {
			// 400 et non 401 : la requete est parfaitement authentifiee, c'est le
			// champ qui est faux. En 401, l'intercepteur du dashboard y voyait un
			// jeton expire — il rafraichissait, rejouait, puis deconnectait, et
			// l'on se retrouvait sur la page de connexion sans savoir pourquoi.
			// Sur le changement force de mot de passe, la boucle etait complete.
			throw new BadRequestException("Mot de passe actuel incorrect.");
		}

		if (await verifySecret(account.passwordHash, newPassword)) {
			throw new ForbiddenException(
				"Le nouveau mot de passe doit être différent de l'ancien.",
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
			action: "auth.password_changed",
			ip: context.ip,
			userAgent: context.userAgent,
		});
	}

	async toSessionUser(account: {
		id: string;
		username: string;
		displayName: string;
		role: AppUserRole;
		mustChangePassword: boolean;
		discordUserId: string | null;
		lastLoginAt: Date | null;
		totpEnabledAt: Date | null;
	}): Promise<SessionUser> {
		return {
			id: account.id,
			username: account.username,
			displayName: account.displayName,
			role: account.role,
			// Meme source que le garde d'API : le dashboard masque exactement ce
			// que l'API refuserait, ni plus ni moins.
			permissions: await this.rolePermissions.resolve(account.role),
			mustChangePassword: account.mustChangePassword,
			discordUserId: account.discordUserId,
			lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
			twoFactorEnabled: account.totpEnabledAt !== null,
			twoFactorAvailable: this.twoFactor.available,
		};
	}
}
