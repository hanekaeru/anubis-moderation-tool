import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { catchError, forkJoin, map, of, switchMap, type Observable } from 'rxjs';
import { WARNING_SEVERITY_LABELS, WarningSeverity, type WarningDto } from '@anubis/shared';
import { ModerationApi } from '../../../core/api/moderation.api';
import { readApiError } from '../../../core/error.interceptor';
import { NotificationService } from '../../../core/notification.service';
import {
  AttachmentPicker,
  type PickedAttachment,
} from '../../../shared/components/attachment-picker';
import { MatTooltip } from "@angular/material/tooltip";

export interface WarningDialogData {
  userId: string;
  memberLabel: string;
}

@Component({
  selector: 'app-warning-dialog',
  imports: [
    AttachmentPicker,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    MatTooltip
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
		<h2 mat-dialog-title>Avertir {{ data.memberLabel }} ?</h2>

		<mat-dialog-content>
			<form [formGroup]="form" class="form" style="margin-top: 4px">
				<mat-form-field class="full">
					<mat-label>Motif</mat-label>
					<textarea
						matInput
						rows="3"
						formControlName="reason"
						maxlength="1000"
						placeholder="Décrivez ce que le membre a fait, en une phrase claire."
					></textarea>
					@if (form.controls.reason.touched && form.controls.reason.invalid) {
						<mat-error>Motif requis (3 caractères minimum).</mat-error>
					}
				</mat-form-field>

				<div class="row" style="margin-top: 16px">
					<mat-form-field>
						<mat-label>Gravité</mat-label>
						<mat-select formControlName="severity">
							@for (severity of severities; track severity) {
								<mat-option [value]="severity">{{ severityLabels[severity] }}</mat-option>
							}
						</mat-select>
					</mat-form-field>

					<mat-form-field [matTooltip]="'Poids dans le cumul des avertissements.'">
						<mat-label>Points</mat-label>
						<input matInput type="number" formControlName="points" min="1" max="100" />
					</mat-form-field>

				</div>

				<div class="attachments">
					<app-attachment-picker [(files)]="files" [disabled]="submitting()" />
				</div>
			</form>

			@if (errorMessage(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}

			@if (uploadWarning(); as warning) {
				<p class="warning" role="alert">{{ warning }}</p>
			}
		</mat-dialog-content>

		<mat-dialog-actions align="end">
			<button matButton mat-dialog-close>Annuler</button>
			<button matButton="filled" [disabled]="submitting()" (click)="submit()">Avertir</button>
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

		.attachments {
			margin-top: 4px;
		}

		.warning {
			margin: 8px 0 0;
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-surface-container-high);
			color: var(--mat-sys-on-surface-variant);
			font-size: 0.84rem;
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
  readonly uploadWarning = signal<string | null>(null);
  readonly files = signal<PickedAttachment[]>([]);

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
    this.uploadWarning.set(null);

    const { reason, severity, points } = this.form.getRawValue();

    this.moderationApi
      .createWarning({ userId: this.data.userId, reason, severity, points })
      .pipe(
        // Apres coup seulement : les pieces jointes ont besoin de
        // l'identifiant de l'avertissement pour s'y rattacher.
        switchMap((warning) => this.uploadAll(warning)),
      )
      .subscribe({
        next: ({ warning, failed }) => {
          if (failed) {
            // L'avertissement est enregistre : le presenter comme un echec
            // pousserait a le ressaisir, et donc a avertir deux fois.
            this.uploadWarning.set(
              `Avertissement enregistré, mais ${failed} pièce(s) jointe(s) n'ont pas pu être envoyées. Tu peux les rajouter depuis la fiche.`,
            );
            this.submitting.set(false);
            return;
          }

          this.notifications.success('Avertissement enregistré.');
          this.dialogRef.close(warning);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.errorMessage.set(readApiError(error));
        },
      });
  }

  /** Envoie les fichiers un par un et compte les echecs, sans jamais rejeter. */
  private uploadAll(
    warning: WarningDto,
  ): Observable<{ warning: WarningDto; failed: number }> {
    const files = this.files();
    if (!files.length) return of({ warning, failed: 0 });

    return forkJoin(
      files.map(({ file, spoiler }) =>
        this.moderationApi
          .uploadAttachment('warnings', warning.id, file, spoiler)
          .pipe(catchError(() => of(null))),
      ),
    ).pipe(
      map((results) => ({
        warning: {
          ...warning,
          attachments: results.filter((ref) => ref !== null),
        },
        failed: results.filter((ref) => ref === null).length,
      })),
    );
  }
}
