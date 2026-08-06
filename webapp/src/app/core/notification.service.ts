import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

/** Retours utilisateur ponctuels. Centralise pour garder un ton homogene. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string): void {
    this.snackBar.open(message, 'Fermer', {
      duration: 4000,
      panelClass: 'snack-success',
    });
  }

  /** Duree plus longue : une erreur doit avoir le temps d'etre lue. */
  error(message: string): void {
    this.snackBar.open(message, 'Fermer', {
      duration: 8000,
      panelClass: 'snack-error',
    });
  }

  info(message: string): void {
    this.snackBar.open(message, 'Fermer', { duration: 4000 });
  }
}
