import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Colore le bouton en rouge pour une action destructrice. */
  destructive?: boolean;
  /** Demande un motif obligatoire ; sa valeur est renvoyee a la fermeture. */
  reasonLabel?: string;
}

/**
 * Confirmation reutilisable, avec motif optionnel.
 *
 * Reunir les deux evite d'avoir une boite par action de moderation : lever une
 * sanction et supprimer une note posent la meme question, seul le libelle change.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p>{{ data.message }}</p>
      @if (data.reasonLabel) {
        <mat-form-field class="full">
          <mat-label>{{ data.reasonLabel }}</mat-label>
          <textarea
            matInput
            rows="3"
            [(ngModel)]="reason"
            maxlength="500"
          ></textarea>
          <mat-hint>Obligatoire, 3 caracteres minimum.</mat-hint>
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Annuler</button>
      <button
        matButton="filled"
        [disabled]="!isValid()"
        [color]="data.destructive ? 'warn' : 'primary'"
        (click)="confirm()"
      >
        {{ data.confirmLabel ?? 'Confirmer' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .full {
      width: 100%;
      margin-top: 8px;
    }
  `,
})
export class ConfirmDialog {
  private readonly dialogRef = inject(MatDialogRef<ConfirmDialog, string | true>);
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);

  reason = '';

  isValid(): boolean {
    return !this.data.reasonLabel || this.reason.trim().length >= 3;
  }

  confirm(): void {
    // Renvoie le motif quand il y en a un, `true` sinon : l'appelant sait
    // lequel il a demande.
    this.dialogRef.close(this.data.reasonLabel ? this.reason.trim() : true);
  }
}
