import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { GuildConfigDto } from '@anubis/shared';
import { GuildConfigApi } from '../../../core/api/guild-config.api';
import { readApiError } from '../../../core/error.interceptor';

/**
 * Creation ou edition d'une entree `config_guild`.
 *
 * `configName` est la cle : elle se fixe a la creation et ne se modifie plus
 * ensuite, sous peine de casser ce qui la lit ailleurs (ex. `/create_logs`).
 */
@Component({
	selector: 'app-log-config-dialog',
	imports: [
		MatButtonModule,
		MatDialogModule,
		MatFormFieldModule,
		MatInputModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>{{ editing ? 'Modifier la configuration' : 'Nouvelle configuration' }}</h2>

		<mat-dialog-content>
			<form [formGroup]="form" class="form">
				<mat-form-field class="full">
					<mat-label>Clé</mat-label>
					<input matInput formControlName="configName" />
					@if (editing) {
						<mat-hint>La clé ne peut pas être modifiée.</mat-hint>
					}
				</mat-form-field>

				<mat-form-field class="full">
					<mat-label>Valeur</mat-label>
					<input matInput formControlName="configValue" />
					<mat-hint>Identifiant de salon pour une entrée LOG_CHANNEL_*.</mat-hint>
				</mat-form-field>

				<mat-form-field class="full">
					<mat-label>Description</mat-label>
					<textarea matInput formControlName="configDescription" rows="3"></textarea>
				</mat-form-field>
			</form>

			@if (errorMessage(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}
		</mat-dialog-content>

		<mat-dialog-actions align="end">
			<button matButton mat-dialog-close>Annuler</button>
			<button matButton="filled" [disabled]="submitting()" (click)="submit()">
				{{ editing ? 'Enregistrer' : 'Creer' }}
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
export class LogConfigDialog {
	private readonly dialogRef = inject(MatDialogRef<LogConfigDialog, boolean>);
	private readonly guildConfigApi = inject(GuildConfigApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly data = inject<GuildConfigDto | null>(MAT_DIALOG_DATA, { optional: true });

	readonly editing = this.data != null;

	readonly submitting = signal(false);
	readonly errorMessage = signal<string | null>(null);

	readonly form = this.formBuilder.nonNullable.group({
		configName: [
			{ value: this.data?.configName ?? '', disabled: this.editing },
			[Validators.required, Validators.maxLength(50)],
		],
		configValue: [this.data?.configValue ?? '', [Validators.required, Validators.maxLength(100)]],
		configDescription: [this.data?.configDescription ?? '', [Validators.required]],
	});

	submit(): void {
		if (this.form.invalid || this.submitting()) {
			this.form.markAllAsTouched();
			return;
		}

		this.submitting.set(true);
		this.errorMessage.set(null);

		const { configName, configValue, configDescription } = this.form.getRawValue();

		const request$ = this.editing
			? this.guildConfigApi.update(this.data!.id, { configValue, configDescription })
			: this.guildConfigApi.create({ configName, configValue, configDescription });

		request$.subscribe({
			next: () => {
				this.submitting.set(false);
				this.dialogRef.close(true);
			},
			error: (error: unknown) => {
				this.submitting.set(false);
				this.errorMessage.set(readApiError(error));
			},
		});
	}
}
