import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ALLOW_TEMPORARY_PASSWORD_KEY } from "../decorators/allow-temporary-password.decorator";
import type { AuthenticatedUser } from "../types";

/**
 * Ferme l'API tant qu'un mot de passe provisoire n'a pas ete remplace.
 *
 * Le dashboard redirige deja vers l'ecran de changement, mais une redirection
 * n'est qu'un confort d'interface : sans ce garde, le jeton d'acces delivre a
 * la premiere connexion ouvre toute l'API en direct. Un administrateur qui
 * remet un mot de passe temporaire donnerait donc un acces complet et permanent
 * a quelqu'un qui n'a jamais choisi son propre mot de passe.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
	constructor(private readonly reflector: Reflector) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<Request>();
		const user = request.user as AuthenticatedUser | undefined;

		// Route publique ou non authentifiee : rien a verifier ici, le garde JWT a
		// deja tranche.
		if (!user?.mustChangePassword) return true;

		const autorisee = this.reflector.getAllAndOverride<boolean>(
			ALLOW_TEMPORARY_PASSWORD_KEY,
			[context.getHandler(), context.getClass()],
		);

		if (autorisee) return true;

		throw new ForbiddenException(
			"Mot de passe provisoire : changez-le avant d'accéder au reste de l'application.",
		);
	}
}
