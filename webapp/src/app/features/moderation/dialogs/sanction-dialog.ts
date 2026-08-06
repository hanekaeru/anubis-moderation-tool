import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
  INSTANT_SANCTION_TYPES,
  MAX_TIMEOUT_SECONDS,
  SANCTION_DURATION_PRESETS,
  SANCTION_TYPE_LABELS,
  SanctionType,
  type SanctionDto,
} from '@anubis/shared';
import { ModerationApi } from '../../../core/api/moderation.api';
import { readApiError } from '../../../core/error.interceptor';
import { NotificationService } from '../../../core/notification.service';

export interface SanctionDialogData {
  userId: string;
  memberLabel: string;
  /** Avertissement a l'origine de la sanction, quand elle en decoule. */
  warningId?: string;
}

@Component({
  selector: 'app-sanction-dialog',
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
    <h2 mat-dialog-title>Sanctionner {{ data.memberLabel }}</h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="form">
        <mat-form-field class="full">
          <mat-label>Type de sanction</mat-label>
          <mat-select formControlName="type">
            @for (type of types; track type) {
              <mat-option [value]="type">{{ typeLabels[type] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        @if (needsDuration()) {
          <mat-form-field class="full">
            <mat-label>Duree</mat-label>
            <mat-select formControlName="durationSeconds">
              @for (preset of durations(); track preset.label) {
                <mat-option [value]="preset.seconds">{{ preset.label }}</mat-option>
              }
            </mat-select>
            @if (isTimeout()) {
              <mat-hint>Discord plafonne les exclusions temporaires a 28 jours.</mat-hint>
            }
          </mat-form-field>
        } @else {
          <p class="note">
            Une sanction de type «&nbsp;{{ typeLabels[selectedType()] }}&nbsp;» prend effet
            immediatement et n'a pas de duree.
          </p>
        }

        <mat-form-field class="full">
          <mat-label>Motif</mat-label>
          <textarea
            matInput
            rows="3"
            formControlName="reason"
            maxlength="1000"
          ></textarea>
          @if (form.controls.reason.touched && form.controls.reason.invalid) {
            <mat-error>Motif requis (3 caracteres minimum).</mat-error>
          }
        </mat-form-field>

        <mat-form-field class="full">
          <mat-label>Lien de preuve (facultatif)</mat-label>
          <input
            matInput
            formControlName="evidenceUrl"
            placeholder="https://..."
            type="url"
          />
          <mat-hint>Message Discord, capture, journal.</mat-hint>
        </mat-form-field>
      </form>

      @if (errorMessage(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Annuler</button>
      <button
        matButton="filled"
        color="warn"
        [disabled]="submitting()"
        (click)="submit()"
      >
        Appliquer la sanction
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      min-width: 400px;
    }

    .full {
      width: 100%;
    }

    .note {
      margin: 0 0 16px;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.84rem;
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
    }
  `,
})
export class SanctionDialog {
  private readonly dialogRef = inject(MatDialogRef<SanctionDialog, SanctionDto>);
  private readonly moderationApi = inject(ModerationApi);
  private readonly notifications = inject(NotificationService);
  private readonly formBuilder = inject(FormBuilder);

  readonly data = inject<SanctionDialogData>(MAT_DIALOG_DATA);
  readonly typeLabels = SANCTION_TYPE_LABELS;
  readonly types = Object.values(SanctionType);

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.formBuilder.nonNullable.group({
    type: ['TIMEOUT' as SanctionType, [Validators.required]],
    durationSeconds: [3600 as number | null],
    reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(1000)]],
    evidenceUrl: [''],
  });

  readonly selectedType = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value,
  });

  readonly needsDuration = computed(
    () => !INSTANT_SANCTION_TYPES.includes(this.selectedType()),
  );

  readonly isTimeout = computed(() => this.selectedType() === 'TIMEOUT');

  /**
   * Une exclusion temporaire ne peut pas etre permanente ni depasser 28 jours :
   * on retire les choix que l'API refuserait plutot que d'afficher une erreur
   * apres coup.
   */
  readonly durations = computed(() =>
    this.isTimeout()
      ? SANCTION_DURATION_PRESETS.filter(
          (preset) => preset.seconds !== null && preset.seconds <= MAX_TIMEOUT_SECONDS,
        )
      : SANCTION_DURATION_PRESETS,
  );

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    const { type, durationSeconds, reason, evidenceUrl } = this.form.getRawValue();

    this.moderationApi
      .createSanction({
        userId: this.data.userId,
        type,
        reason,
        durationSeconds: this.needsDuration() ? durationSeconds : null,
        warningId: this.data.warningId ?? null,
        evidenceUrl: evidenceUrl.trim() || null,
      })
      .subscribe({
        next: (sanction) => {
          this.notifications.success('Sanction appliquee.');
          this.dialogRef.close(sanction);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.errorMessage.set(readApiError(error));
        },
      });
  }
}
