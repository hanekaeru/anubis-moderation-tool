import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  WARNING_SEVERITY_LABELS,
  WarningSeverity,
  type WarningDto,
} from '@anubis/shared';
import { ModerationApi } from '../../../core/api/moderation.api';
import { readApiError } from '../../../core/error.interceptor';
import { NotificationService } from '../../../core/notification.service';

export interface WarningDialogData {
  userId: string;
  memberLabel: string;
}

@Component({
  selector: 'app-warning-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Avertir {{ data.memberLabel }}</h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="form">
        <mat-form-field class="full">
          <mat-label>Motif</mat-label>
          <textarea
            matInput
            rows="3"
            formControlName="reason"
            maxlength="1000"
            placeholder="Ce que le membre a fait, en une phrase claire"
          ></textarea>
          @if (form.controls.reason.touched && form.controls.reason.invalid) {
            <mat-error>Motif requis (3 caracteres minimum).</mat-error>
          }
        </mat-form-field>

        <div class="row">
          <mat-form-field>
            <mat-label>Gravite</mat-label>
            <mat-select formControlName="severity">
              @for (severity of severities; track severity) {
                <mat-option [value]="severity">{{ severityLabels[severity] }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field>
            <mat-label>Points</mat-label>
            <input matInput type="number" formControlName="points" min="1" max="100" />
            <mat-hint>Poids dans le cumul d'avertissements.</mat-hint>
          </mat-form-field>
        </div>
      </form>

      @if (errorMessage(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Annuler</button>
      <button matButton="filled" [disabled]="submitting()" (click)="submit()">
        Avertir
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      min-width: 380px;
    }

    .full {
      width: 100%;
    }

    .row {
      display: flex;
      gap: 12px;

      mat-form-field {
        flex: 1;
      }
    }

    .error {
      margin: 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font-size: 0.86rem;
    }

    @media (max-width: 520px) {
      .form {
        min-width: 0;
      }

      .row {
        flex-direction: column;
        gap: 0;
      }
    }
  `,
})
export class WarningDialog {
  private readonly dialogRef = inject(MatDialogRef<WarningDialog, WarningDto>);
  private readonly moderationApi = inject(ModerationApi);
  private readonly notifications = inject(NotificationService);
  private readonly formBuilder = inject(FormBuilder);

  readonly data = inject<WarningDialogData>(MAT_DIALOG_DATA);
  readonly severityLabels = WARNING_SEVERITY_LABELS;
  readonly severities = Object.values(WarningSeverity);

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.formBuilder.nonNullable.group({
    reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(1000)]],
    severity: ['LOW' as WarningSeverity, [Validators.required]],
    points: [1, [Validators.required, Validators.min(1), Validators.max(100)]],
  });

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    const { reason, severity, points } = this.form.getRawValue();

    this.moderationApi
      .createWarning({ userId: this.data.userId, reason, severity, points })
      .subscribe({
        next: (warning) => {
          this.notifications.success('Avertissement enregistre.');
          this.dialogRef.close(warning);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.errorMessage.set(readApiError(error));
        },
      });
  }
}
