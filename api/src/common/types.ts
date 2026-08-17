import type { AppUserRole, Permission } from "@anubis/shared";

/** Ce que le guard JWT attache a la requete apres validation du jeton. */
export interface AuthenticatedUser {
	id: string;
	username: string;
	displayName: string;
	role: AppUserRole;
	permissions: Permission[];
	mustChangePassword: boolean;
	/**
	 * Session (famille de refresh tokens) d'ou vient la requete.
	 *
	 * Portee par l'access token plutot que deduite du cookie : celui-ci est
	 * limite au chemin `/api/auth` et n'atteint donc aucune autre route. C'est
	 * ce qui permet a la page « Sessions actives » de reperer la session
	 * courante — et de refuser de la couper par megarde. `undefined` pour un
	 * jeton emis avant l'ajout du champ, le temps qu'il expire.
	 */
	sessionId?: string;
}

declare module "express" {
	interface Request {
		user?: AuthenticatedUser;
	}
}
