import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  DEFAULT_MODERATION_POINTS,
  INSTANT_SANCTION_TYPES,
  MAX_MODERATION_POINTS,
  MAX_TIMEOUT_SECONDS,
  MIN_MODERATION_POINTS,
  SANCTION_DURATION_PRESETS,
  SANCTION_TYPE_LABELS,
  SanctionType,
  type ModerationPointsConfigDto,
  type SanctionDto,
} from '@anubis/shared';
import { catchError, forkJoin, map, of, switchMap, type Observable } from 'rxjs';
import { ModerationApi } from '../../../core/api/moderation.api';
import { readApiError } from '../../../core/error.interceptor';
import { NotificationService } from '../../../core/notification.service';
import {
  AttachmentPicker,
  type PickedAttachment,
} from '../../../shared/components/attachment-picker';

export interface SanctionDialogData {
  userId: string;
  memberLabel: string;
  /** Avertissement a l'origine de la sanction, quand elle en decoule. */
  warningId?: string;
}

@Component({
  selector: 'app-sanction-dialog',
  imports: [
    AttachmentPicker,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
		<h2 mat-dialog-title>Sanctionner {{ data.memberLabel }} ?</h2>

		<mat-dialog-content>
			<form [formGroup]="form" class="form" style="margin-top: 4px">
				<mat-form-field class="full">
					<mat-label>Type de sanction</mat-label>
					<mat-select formControlName="type">
						@for (type of types; track type) {
							<mat-option [value]="type">{{ typeLabels[type] }}</mat-option>
						}
					</mat-select>
				</mat-form-field>

				@if (needsDuration()) {
					<mat-form-field class="full" style="margin-top: 8px">
						<mat-label>Durée</mat-label>
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
					<p class="note" style="margin-top: 16px">
						Une sanction de type «&nbsp;{{ typeLabels[selectedType()] }}&nbsp;» prend effet
						immédiatement et n'a pas de durée.
					</p>
				}

				<mat-form-field class="full" style="margin-top: 8px">
					<mat-label>Motif</mat-label>
					<textarea matInput rows="3" formControlName="reason" maxlength="1000"></textarea>
					@if (form.controls.reason.touched && form.controls.reason.invalid) {
						<mat-error>Motif requis (3 caractères minimum).</mat-error>
					}
				</mat-form-field>

				<mat-form-field class="full" style="margin-top: 8px">
					<mat-label>Points</mat-label>
					<input matInput type="number" formControlName="points" min="0" max="100" />
					<mat-hint>Poids dans le score du membre, pré-rempli par le barème du serveur.</mat-hint>
				</mat-form-field>

				<mat-form-field class="full" style="margin-top: 8px">
					<mat-label>Lien de preuve (facultatif)</mat-label>
					<input matInput formControlName="evidenceUrl" placeholder="https://..." type="url" />
					<mat-hint>Permalien vers le message Discord incriminé.</mat-hint>
				</mat-form-field>

				<div class="attachments">
					<app-attachment-picker [(files)]="files" [disabled]="submitting()" />
				</div>
			</form>

			@if (uploadWarning(); as warning) {
				<p class="warning" role="alert">{{ warning }}</p>
			}

			@if (errorMessage(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}
		</mat-dialog-content>

		<mat-dialog-actions align="end">
			<button matButton mat-dialog-close>Annuler</button>
			<button matButton="filled" color="warn" [disabled]="submitting()" (click)="submit()">
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

		.attachments {
			margin-top: 12px;
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
  readonly uploadWarning = signal<string | null>(null);
  readonly files = signal<PickedAttachment[]>([]);

  readonly form = this.formBuilder.nonNullable.group({
    type: ['TIMEOUT' as SanctionType, [Validators.required]],
    durationSeconds: [3600 as number | null],
    reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(1000)]],
    evidenceUrl: [''],
    points: [
      DEFAULT_MODERATION_POINTS.sanctionPoints.TIMEOUT,
      [
        Validators.required,
        Validators.min(MIN_MODERATION_POINTS),
        Validators.max(MAX_MODERATION_POINTS),
      ],
    ],
  });

  readonly selectedType = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value,
  });

  readonly needsDuration = computed(() => !INSTANT_SANCTION_TYPES.includes(this.selectedType()));

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

  private readonly pointsConfig = signal<ModerationPointsConfigDto | null>(null);

  constructor() {
    this.moderationApi.getPointsConfig().subscribe({
      next: (config) => this.pointsConfig.set(config),
      // Le bareme n'est qu'une aide a la saisie : s'il ne se charge pas, la
      // valeur par defaut du formulaire suffit et l'API tranchera.
      error: () => undefined,
    });

    /**
     * Le champ suit le type choisi tant que personne n'y a touche. Une fois le
     * moderateur intervenu (`dirty`), sa valeur l'emporte : changer de type ne
     * doit pas effacer un ajustement volontaire.
     */
    effect(() => {
      const config = this.pointsConfig();
      const type = this.selectedType();
      if (!config || this.form.controls.points.dirty) return;
      this.form.controls.points.setValue(config.sanctionPoints[type]);
    });
  }

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    this.uploadWarning.set(null);

    const { type, durationSeconds, reason, evidenceUrl, points } = this.form.getRawValue();

    this.moderationApi
      .createSanction({
        userId: this.data.userId,
        type,
        reason,
        isApplied: false,
        durationSeconds: this.needsDuration() ? durationSeconds : null,
        points,
        warningId: this.data.warningId ?? null,
        evidenceUrl: evidenceUrl.trim() || null,
      })
      .pipe(
        // Les pieces jointes ne peuvent partir qu'apres coup : elles ont besoin
        // de l'identifiant de la sanction pour s'y rattacher.
        switchMap((sanction) => this.uploadAll(sanction)),
      )
      .subscribe({
        next: ({ sanction, failed }) => {
          if (failed) {
            // La sanction, elle, est bien posee : la signaler comme un echec
            // pousserait a la rejouer, et donc a sanctionner deux fois.
            this.uploadWarning.set(
              `Sanction appliquée, mais ${failed} pièce(s) jointe(s) n'ont pas pu être envoyées. Tu peux les rajouter depuis la fiche.`,
            );
            this.submitting.set(false);
            return;
          }

          this.notifications.success('Sanction appliquée.');
          this.dialogRef.close(sanction);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.errorMessage.set(readApiError(error));
        },
      });
  }

  /** Envoie les fichiers un par un et compte les echecs, sans jamais rejeter. */
  private uploadAll(
    sanction: SanctionDto,
  ): Observable<{ sanction: SanctionDto; failed: number }> {
    const files = this.files();
    if (!files.length) return of({ sanction, failed: 0 });

    return forkJoin(
      files.map(({ file, spoiler }) =>
        this.moderationApi
          .uploadAttachment('sanctions', sanction.id, file, spoiler)
          .pipe(catchError(() => of(null))),
      ),
    ).pipe(
      map((results) => ({
        sanction: {
          ...sanction,
          attachments: results.filter((ref) => ref !== null),
        },
        failed: results.filter((ref) => ref === null).length,
      })),
    );
  }
}
