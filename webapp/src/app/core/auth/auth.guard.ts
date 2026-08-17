import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { Permission } from '@anubis/shared';
import { NotificationService } from '../notification.service';
import { AuthService } from './auth.service';

/** Bloque l'acces aux pages du dashboard tant que la session n'est pas etablie. */
export const authGuard: CanActivateFn = (_route, state) => {
	const auth = inject(AuthService);
	const router = inject(Router);

	if (!auth.isAuthenticated()) {
		// L'URL demandee est conservee pour y revenir apres connexion.
		return router.createUrlTree(['/connexion'], {
			queryParams: { redirect: state.url },
		});
	}

	// Un mot de passe provisoire doit etre change avant toute autre action.
	if (auth.mustChangePassword() && !state.url.startsWith('/mot-de-passe')) {
		return router.createUrlTree(['/mot-de-passe']);
	}

	return true;
};

/** Empeche un compte connecte de revenir sur l'ecran de connexion. */
export const guestGuard: CanActivateFn = () => {
	const auth = inject(AuthService);
	const router = inject(Router);

	return auth.isAuthenticated() ? router.createUrlTree(['/']) : true;
};

/**
 * Restreint une route a une permission.
 *
 * C'est un confort d'interface, pas une securite : l'API revalide chaque
 * permission de son cote. Un utilisateur qui forcerait l'URL verrait la page
 * mais aucune donnee.
 */
export function permissionGuard(...required: Permission[]): CanActivateFn {
	return () => {
		const auth = inject(AuthService);
		const router = inject(Router);
		const notifications = inject(NotificationService);

		if (required.every((permission) => auth.hasPermission(permission))) {
			return true;
		}

		notifications.error("Vous n'avez pas accès à cette section.");
		return router.createUrlTree(['/']);
	};
}
