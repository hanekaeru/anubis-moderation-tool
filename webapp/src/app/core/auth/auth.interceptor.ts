import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  catchError,
  filter,
  switchMap,
  take,
  throwError,
} from 'rxjs';
import { AuthService } from './auth.service';

/** Vrai pendant qu'un rafraichissement est en cours. */
let refreshing = false;
/** Diffuse le nouveau jeton aux requetes mises en attente. */
const refreshed = new BehaviorSubject<string | null>(null);

/** Routes d'authentification : ne jamais tenter de les rejouer apres un 401. */
const AUTH_ROUTES = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout'];

function withToken(
  request: HttpRequest<unknown>,
  token: string | null,
): HttpRequest<unknown> {
  if (!token) return request;
  return request.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
    withCredentials: true,
  });
}

/**
 * Ajoute l'access token et, sur un 401, tente un rafraichissement unique.
 *
 * Les requetes concurrentes qui echouent pendant ce laps de temps ne declenchent
 * pas chacune leur propre rafraichissement : elles attendent le resultat du
 * premier, sans quoi une page chargeant six appels en parallele ferait tourner
 * six fois le refresh token et invaliderait sa propre session.
 */
export function authInterceptor(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const auth = inject(AuthService);
  const router = inject(Router);

  const isAuthRoute = AUTH_ROUTES.some((route) => request.url.startsWith(route));
  const authorized = isAuthRoute
    ? request.clone({ withCredentials: true })
    : withToken(request, auth.token());

  return next(authorized).pipe(
    catchError((error: unknown) => {
      const is401 =
        error instanceof HttpErrorResponse && error.status === 401;

      if (!is401 || isAuthRoute) {
        return throwError(() => error);
      }

      if (refreshing) {
        return refreshed.pipe(
          filter((token): token is string => token !== null),
          take(1),
          switchMap((token) => next(withToken(request, token))),
        );
      }

      refreshing = true;
      refreshed.next(null);

      return auth.refreshToken().pipe(
        switchMap((token) => {
          refreshing = false;
          refreshed.next(token);
          return next(withToken(request, token));
        }),
        catchError((refreshError: unknown) => {
          refreshing = false;
          auth.clearSession();
          void router.navigate(['/connexion']);
          return throwError(() => refreshError);
        }),
      );
    }),
  );
}
