import {
	ApplicationConfig,
	inject,
	provideAppInitializer,
	provideBrowserGlobalErrorListeners,
	provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { provideEchartsCore } from 'ngx-echarts';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { errorInterceptor } from './core/error.interceptor';

export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		provideZoneChangeDetection({ eventCoalescing: true }),
		provideRouter(
			routes,
			// Lie les parametres de route aux entrees des composants : plus besoin
			// d'injecter ActivatedRoute pour lire un identifiant d'URL.
			withComponentInputBinding(),
			withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
		),
		provideHttpClient(
			withFetch(),
			// L'ordre importe : l'intercepteur d'authentification doit pouvoir
			// rejouer une requete avant que celui d'erreurs ne la signale.
			withInterceptors([authInterceptor, errorInterceptor]),
		),
		provideAnimationsAsync(),
		// ECharts est charge a la demande : c'est la plus grosse dependance du
		// projet, et la moitie des ecrans n'affiche aucun graphique.
		provideEchartsCore({ echarts: () => import('echarts') }),
		{
			provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
			useValue: { appearance: 'outline', subscriptSizing: 'dynamic' },
		},
		// Rejoue le cookie de refresh avant le premier rendu, pour qu'un
		// rechargement de page ne renvoie pas vers l'ecran de connexion.
		provideAppInitializer(() => inject(AuthService).restoreSession()),
	],
};
