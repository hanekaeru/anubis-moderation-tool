import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import type { ApiErrorBody } from '@anubis/shared';
import { NotificationService } from './notification.service';

/** Extrait le message lisible du format d'erreur renvoye par l'API. */
export function readApiError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Une erreur inattendue est survenue.';
  }

  if (error.status === 0) {
    return "L'API est injoignable. Verifiez qu'elle est demarree.";
  }

  const body = error.error as Partial<ApiErrorBody> | null;

  if (body?.details) {
    const messages = Object.values(body.details).flat();
    if (messages.length) return messages.join(' ');
  }

  return body?.message ?? `Erreur ${error.status}.`;
}

/**
 * Affiche les erreurs serveur.
 *
 * Les 401 sont ignores : l'intercepteur d'authentification les traite en
 * rejouant la requete, et signaler chaque expiration de jeton serait du bruit.
 * Les 422/400 remontent au composant, qui sait les afficher champ par champ.
 */
export function errorInterceptor(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const notifications = inject(NotificationService);

  return next(request).pipe(
    catchError((error: unknown) => {
      const status =
        error instanceof HttpErrorResponse ? error.status : 0;

      const silent = status === 401 || status === 400 || status === 422;

      if (!silent) {
        notifications.error(readApiError(error));
      }

      return throwError(() => error);
    }),
  );
}
