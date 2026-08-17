import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
	APP_USER_ROLE_LABELS,
	AppUserRole,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	USERNAME_PATTERN,
} from '@anubis/shared';
import { AppUsersApi } from '../../../core/api/app-users.api';
import { readApiError } from '../../../core/error.interceptor';

/**
 * Creation d'un compte du staff.
 *
 * Le mot de passe est genere par le serveur et affiche une seule fois : il
 * n'est stocke qu'en forme hachee, personne ne pourra le relire ensuite.
 */
@Component({
	selector: 'app-app-user-dialog',
	imports: [
		MatButtonModule,
		MatDialogModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatSelectModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>Nouveau compte</h2>

		<mat-dialog-content>
			@if (generatedPassword(); as password) {
				<div class="password-panel">
					<p class="password-label">Mot de passe provisoire</p>
					<code class="password-value">{{ password }}</code>
					<p class="password-warning">
						<mat-icon>warning</mat-icon>
						Notez-le maintenant : il ne sera plus affiché. Le titulaire devra le changer à sa
						première connexion.
					</p>
					<button matButton="outlined" (click)="copyPassword(password)">
						<mat-icon>content_copy</mat-icon>
						Copier
					</button>
				</div>
			} @else {
				<form [formGroup]="form" class="form">
					<mat-form-field class="full">
						<mat-label>Identifiant de connexion</mat-label>
						<input matInput formControlName="username" autocapitalize="none" spellcheck="false" />
						<mat-hint>Lettres, chiffres, point, tiret et underscore.</mat-hint>
						@if (form.controls.username.touched && form.controls.username.invalid) {
							<mat-error>Identifiant invalide.</mat-error>
						}
					</mat-form-field>

					<mat-form-field class="full">
						<mat-label>Nom affiché</mat-label>
						<input matInput formControlName="displayName" />
					</mat-form-field>

					<mat-form-field class="full">
						<mat-label>Rôle</mat-label>
						<mat-select formControlName="role">
							@for (role of roles; track role) {
								<mat-option [value]="role">{{ roleLabels[role] }}</mat-option>
							}
						</mat-select>
					</mat-form-field>

					<mat-form-field class="full">
						<mat-label>Identifiant Discord (facultatif)</mat-label>
						<input matInput formControlName="discordUserId" inputmode="numeric" />
						<mat-hint>Relie le compte à l'identité Discord du modérateur.</mat-hint>
					</mat-form-field>
				</form>

				@if (errorMessage(); as message) {
					<p class="error" role="alert">{{ message }}</p>
				}
			}
		</mat-dialog-content>

		<mat-dialog-actions align="end">
			@if (generatedPassword()) {
				<button matButton="filled" [mat-dialog-close]="true">Terminer</button>
			} @else {
				<button matButton mat-dialog-close>Annuler</button>
				<button matButton="filled" [disabled]="submitting()" (click)="submit()">
					Créer le compte
				</button>
			}
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

		.password-panel {
			min-width: 400px;
			padding: 16px;
			border-radius: 10px;
			background: var(--mat-sys-surface-container-high);
		}

		.password-label {
			margin: 0 0 8px;
			font-size: 0.78rem;
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--mat-sys-on-surface-variant);
		}

		.password-value {
			display: block;
			padding: 12px;
			border-radius: 8px;
			background: var(--mat-sys-surface);
			font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
			font-size: 1rem;
			word-break: break-all;
			user-select: all;
		}

		.password-warning {
			display: flex;
			align-items: flex-start;
			gap: 8px;
			margin: 12px 0;
			font-size: 0.84rem;
			color: var(--mat-sys-on-surface-variant);
			line-height: 1.4;
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
			.form,
			.password-panel {
				min-width: 0;
			}
		}
	`,
})
export class AppUserDialog {
	private readonly dialogRef = inject(MatDialogRef<AppUserDialog, boolean>);
	private readonly appUsersApi = inject(AppUsersApi);
	private readonly formBuilder = inject(FormBuilder);

	readonly roleLabels = APP_USER_ROLE_LABELS;
	readonly roles = Object.values(AppUserRole);

	readonly submitting = signal(false);
	readonly errorMessage = signal<string | null>(null);
	readonly generatedPassword = signal<string | null>(null);

	readonly form = this.formBuilder.nonNullable.group({
		username: [
			'',
			[
				Validators.required,
				Validators.minLength(USERNAME_MIN_LENGTH),
				Validators.maxLength(USERNAME_MAX_LENGTH),
				Validators.pattern(USERNAME_PATTERN),
			],
		],
		displayName: ['', [Validators.required, Validators.maxLength(80)]],
		role: ['MODERATOR' as AppUserRole, [Validators.required]],
		discordUserId: ['', [Validators.pattern(/^\d{17,20}$/)]],
	});

	copyPassword(password: string): void {
		void navigator.clipboard?.writeText(password);
	}

	submit(): void {
		if (this.form.invalid || this.submitting()) {
			this.form.markAllAsTouched();
			return;
		}

		this.submitting.set(true);
		this.errorMessage.set(null);

		const { username, displayName, role, discordUserId } = this.form.getRawValue();

		this.appUsersApi
			.create({
				username,
				displayName,
				role,
				discordUserId: discordUserId.trim() || null,
			})
			.subscribe({
				next: (response) => {
					this.submitting.set(false);
					// Le dialogue reste ouvert : c'est le seul moment ou le mot de passe
					// est lisible, le fermer trop tot le perdrait.
					this.generatedPassword.set(response.generatedPassword);
				},
				error: (error: unknown) => {
					this.submitting.set(false);
					this.errorMessage.set(readApiError(error));
				},
			});
	}
}
