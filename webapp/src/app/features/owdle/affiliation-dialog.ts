import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MAX_OWDLE_AFFILIATION_LABEL_LENGTH, type OwdleAffiliationDto } from '@anubis/shared';
import { OwdleApi } from '../../core/api/owdle.api';
import { readApiError } from '../../core/error.interceptor';

/** `null` pour une creation. */
export type AffiliationDialogData = OwdleAffiliationDto | null;

/**
 * Creation ou renommage d'une affiliation.
 *
 * Seul le libelle se saisit : la cle se tire du libelle cote API, a la creation
 * seulement. Renommer vaut donc pour tous les heros qui la portent.
 */
@Component({
	selector: 'app-owdle-affiliation-dialog',
	imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>{{ data ? 'Renommer ' + data.label : 'Nouvelle affiliation' }}</h2>

		<mat-dialog-content>
			<form [formGroup]="form" class="form" (ngSubmit)="save()">
				<mat-form-field>
					<mat-label>Libellé</mat-label>
					<input matInput formControlName="label" [maxlength]="maxLength" />
					@if (data && data.heroCount > 0) {
						<mat-hint>Renommée pour ses {{ data.heroCount }} héros d'un coup.</mat-hint>
					}
					@if (form.controls.label.hasError('required')) {
						<mat-error>Le libellé est requis.</mat-error>
					}
				</mat-form-field>
			</form>

			@if (error(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}
		</mat-dialog-content>

		<mat-dialog-actions align="end">
			<button matButton mat-dialog-close>Annuler</button>
			<button matButton="filled" [disabled]="saving()" (click)="save()">Enregistrer</button>
		</mat-dialog-actions>
	`,
	styles: `
		.form {
			display: flex;
			flex-direction: column;
			min-width: 340px;
			padding-top: 4px;
		}

		.error {
			margin: var(--space-3) 0 0;
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-error-container);
			color: var(--mat-sys-on-error-container);
		}

		@media (max-width: 520px) {
			.form {
				min-width: 0;
			}
		}
	`,
})
export class OwdleAffiliationDialog {
	private readonly api = inject(OwdleApi);
	private readonly dialogRef = inject(MatDialogRef<OwdleAffiliationDialog, OwdleAffiliationDto>);
	readonly data = inject<AffiliationDialogData>(MAT_DIALOG_DATA);

	readonly maxLength = MAX_OWDLE_AFFILIATION_LABEL_LENGTH;
	readonly saving = signal(false);
	readonly error = signal<string | null>(null);

	readonly form = inject(FormBuilder).nonNullable.group({
		label: [
			this.data?.label ?? '',
			[Validators.required, Validators.maxLength(MAX_OWDLE_AFFILIATION_LABEL_LENGTH)],
		],
	});

	save(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}

		const request = { label: this.form.getRawValue().label.trim() };
		this.saving.set(true);
		this.error.set(null);
		const appel = this.data
			? this.api.renameAffiliation(this.data.key, request)
			: this.api.createAffiliation(request);

		appel.subscribe({
			next: (affiliation) => this.dialogRef.close(affiliation),
			error: (err: unknown) => {
				this.saving.set(false);
				this.error.set(readApiError(err));
			},
		});
	}
}
