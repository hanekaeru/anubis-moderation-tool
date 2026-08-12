import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Post,
	Req,
	Res,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { CookieOptions, Request, Response } from "express";
import type { LoginResponse, SessionUser } from "@anubis/shared";
import type { AppConfig } from "../config/configuration";
import { AllowTemporaryPassword } from "../common/decorators/allow-temporary-password.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService, type RequestContext } from "./auth.service";
import { ChangePasswordDto, LoginDto } from "./dto/login.dto";

/** Nom du cookie portant le refresh token. */
const REFRESH_COOKIE = "anubis_rt";

/**
 * Seul controleur ouvert a un compte dont le mot de passe est encore
 * provisoire : sans lui, un tel compte ne pourrait ni lire son etat ni changer
 * son mot de passe, donc jamais sortir de cet etat.
 */
@Controller("auth")
@AllowTemporaryPassword()
export class AuthController {
	constructor(
		private readonly auth: AuthService,
		private readonly prisma: PrismaService,
		private readonly config: ConfigService<{ app: AppConfig }, true>,
	) {}

	private get appConfig(): AppConfig {
		return this.config.get("app", { infer: true });
	}

	private context(req: Request): RequestContext {
		return {
			ip: req.ip,
			userAgent: req.get("user-agent") ?? undefined,
		};
	}

	private cookieOptions(expiresAt?: Date): CookieOptions {
		return {
			httpOnly: true,
			secure: this.appConfig.cookieSecure,
			// 'lax' suffit : le dashboard et l'API partagent le meme site en
			// developpement comme en production. Passer a 'none' (avec secure) seulement
			// si l'API est servie depuis un domaine reellement different.
			sameSite: "lax",
			// Limite l'envoi du cookie aux seules routes qui en ont besoin.
			path: "/api/auth",
			...(expiresAt ? { expires: expiresAt } : {}),
		};
	}

	/** 5 tentatives par minute et par IP, pour freiner le bourrage d'identifiants. */
	@Public()
	@Throttle({ default: { limit: 5, ttl: 60_000 } })
	@Post("login")
	@HttpCode(HttpStatus.OK)
	async login(
		@Body() dto: LoginDto,
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	): Promise<LoginResponse> {
		const result = await this.auth.login(
			dto.username,
			dto.password,
			this.context(req),
		);

		res.cookie(
			REFRESH_COOKIE,
			result.refreshToken,
			this.cookieOptions(result.refreshExpiresAt),
		);

		return {
			accessToken: result.accessToken,
			expiresIn: result.expiresIn,
			user: result.user,
		};
	}

	@Public()
	@Post("refresh")
	@HttpCode(HttpStatus.OK)
	async refresh(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	): Promise<LoginResponse> {
		const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;

		if (!token) {
			throw new UnauthorizedException("Aucune session active.");
		}

		const result = await this.auth.refresh(token, this.context(req));

		res.cookie(
			REFRESH_COOKIE,
			result.refreshToken,
			this.cookieOptions(result.refreshExpiresAt),
		);

		return {
			accessToken: result.accessToken,
			expiresIn: result.expiresIn,
			user: result.user,
		};
	}

	@Public()
	@Post("logout")
	@HttpCode(HttpStatus.NO_CONTENT)
	async logout(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	): Promise<void> {
		const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
		await this.auth.logout(token, this.context(req));
		res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
	}

	@Get("me")
	async me(@CurrentUser() user: AuthenticatedUser): Promise<SessionUser> {
		const account = await this.prisma.appUser.findUnique({
			where: { id: user.id },
		});

		// Le compte peut avoir ete supprime entre la validation du jeton et cette
		// requete : c'est une session devenue invalide, pas une panne serveur.
		if (!account) {
			throw new UnauthorizedException("Compte introuvable.");
		}

		return this.auth.toSessionUser(account);
	}

	@Post("password")
	@HttpCode(HttpStatus.NO_CONTENT)
	async changePassword(
		@CurrentUser() user: AuthenticatedUser,
		@Body() dto: ChangePasswordDto,
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	): Promise<void> {
		await this.auth.changePassword(
			user.id,
			dto.currentPassword,
			dto.newPassword,
			this.context(req),
		);
		// Toutes les sessions ont ete revoquees, y compris celle-ci.
		res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
	}
}
