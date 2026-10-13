import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import type { EsportTeamDto } from '@anubis/shared';
import { EsportApi } from '../../core/api/esport.api';
import { readApiError } from '../../core/error.interceptor';
import { customEmojiUrl } from './discord-markdown';

/** `null` pour une creation. */
export type TeamDialogData = EsportTeamDto | null;

@Component({
	selector: 'app-esport-team-dialog',
	imports: [
		MatButtonModule,
		MatDialogModule,
		MatFormFieldModule,
		MatInputModule,
		MatSlideToggleModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>{{ data ? 'Modifier ' + data.name : 'Nouvelle équipe' }}</h2>

		<mat-dialog-content>
			<form [formGroup]="form" class="form">
				<mat-form-field>
					<mat-label>Nom</mat-label>
					<input matInput formControlName="name" maxlength="80" />
					@if (form.controls.name.hasError('required')) {
						<mat-error>Le nom est requis.</mat-error>
					}
				</mat-form-field>

				<mat-form-field>
					<mat-label>Emoji</mat-label>
					<input matInput formControlName="emoji" maxlength="100" placeholder="🦅 ou <:falcons:123456789012345678>" />
					<mat-hint>
						Un emoji du serveur s'écrit &lt;:nom:identifiant&gt; : tapez \\:nom: dans Discord pour
						l'obtenir.
					</mat-hint>
				</mat-form-field>

				<mat-form-field>
					<mat-label>Logo (adresse de l'image)</mat-label>
					<input matInput formControlName="logoUrl" placeholder="https://…" />
					<mat-hint>Affiché sur l'annonce de résultat quand l'équipe gagne, hors spoiler.</mat-hint>
					@if (form.controls.logoUrl.hasError('pattern')) {
						<mat-error>Adresse http(s) attendue.</mat-error>
					}
				</mat-form-field>

				<mat-slide-toggle formControlName="highlighted">
					Équipe suivie (nom en gras dans les récapitulatifs)
				</mat-slide-toggle>

				<p class="apercu">
					Aperçu :
					@if (emojiUrl()) {
						<img [src]="emojiUrl()" alt="" />
					} @else if (value().emoji) {
						{{ value().emoji }}
					}
					@if (value().highlighted) {
						<strong>{{ value().name || 'Nom' }}</strong>
					} @else {
						{{ value().name || 'Nom' }}
					}
				</p>
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
			gap: var(--space-3);
			min-width: 380px;
			padding-top: 4px;
		}

		.apercu {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			margin: 0;
			color: var(--mat-sys-on-surface-variant);

			img {
				width: 20px;
				height: 20px;
			}
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
export class EsportTeamDialog {
	private readonly api = inject(EsportApi);
	private readonly dialogRef = inject(MatDialogRef<EsportTeamDialog, EsportTeamDto>);
	readonly data = inject<TeamDialogData>(MAT_DIALOG_DATA);

	readonly saving = signal(false);
	readonly error = signal<string | null>(null);

	readonly form = inject(FormBuilder).nonNullable.group({
		name: [this.data?.name ?? '', [Validators.required, Validators.maxLength(80)]],
		emoji: [this.data?.emoji ?? ''],
		logoUrl: [this.data?.logoUrl ?? '', [Validators.pattern(/^https?:\/\/\S+$/)]],
		highlighted: [this.data?.highlighted ?? false],
	});

	readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
	readonly emojiUrl = computed(() => customEmojiUrl(this.value().emoji?.trim() ?? null));

	save(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}

		const raw = this.form.getRawValue();
		const request = {
			name: raw.name.trim(),
			emoji: raw.emoji.trim() || null,
			logoUrl: raw.logoUrl.trim() || null,
			highlighted: raw.highlighted,
		};

		this.saving.set(true);
		this.error.set(null);
		const appel = this.data
			? this.api.updateTeam(this.data.id, request)
			: this.api.createTeam(request);

		appel.subscribe({
			next: (team) => this.dialogRef.close(team),
			error: (err: unknown) => {
				this.saving.set(false);
				this.error.set(readApiError(err));
			},
		});
	}
}
