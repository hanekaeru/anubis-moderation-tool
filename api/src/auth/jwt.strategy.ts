import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { AppConfig } from "../config/configuration";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import { RolePermissionsService } from "../role-permissions/role-permissions.service";
import type { AccessTokenPayload } from "./token.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
	constructor(
		config: ConfigService<{ app: AppConfig }, true>,
		private readonly prisma: PrismaService,
		private readonly rolePermissions: RolePermissionsService,
	) {
		super({
			jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
			ignoreExpiration: false,
			secretOrKey: config.get("app", { infer: true }).jwt.accessSecret,
		});
	}

	/**
	 * Le compte est relu en base a chaque requete plutot que decode depuis le
	 * jeton. C'est un aller-retour de plus, mais une desactivation ou un
	 * changement de role prend effet immediatement au lieu d'attendre
	 * l'expiration de l'access token.
	 */
	async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
		const account = await this.prisma.appUser.findUnique({
			where: { id: payload.sub },
			select: {
				id: true,
				username: true,
				displayName: true,
				role: true,
				isActive: true,
				mustChangePassword: true,
			},
		});

		if (!account || !account.isActive) {
			throw new UnauthorizedException("Compte introuvable ou désactivé.");
		}

		return {
			id: account.id,
			username: account.username,
			displayName: account.displayName,
			role: account.role,
			// Resolues a partir du role, pas du jeton : un reglage de permissions
			// prend effet immediatement, pour la meme raison que le compte est
			// relu ci-dessus.
			permissions: await this.rolePermissions.resolve(account.role),
			mustChangePassword: account.mustChangePassword,
			sessionId: payload.sid,
		};
	}
}
