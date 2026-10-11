import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
	AbstractControl,
	FormBuilder,
	ReactiveFormsModule,
	ValidationErrors,
	Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { PASSWORD_MIN_LENGTH } from '@anubis/shared';
import { AuthService } from '../../../core/auth/auth.service';
import { readApiError } from '../../../core/error.interceptor';
import { NotificationService } from '../../../core/notification.service';

/**
 * Vérifie que la confirmation correspond au nouveau mot de passe.
 *
 * L'erreur est posée **sur le champ de confirmation**, pas seulement sur le
 * groupe. `mat-form-field` n'affiche un `mat-error` que lorsque *son* contrôle
 * est en erreur : une erreur de groupe laissait le champ parfaitement valide à
 * ses yeux, et le message restait invisible. On pouvait alors cliquer
 * « Enregistrer » indéfiniment sans jamais savoir ce qui bloquait.
 */
function passwordsMatch(group: AbstractControl): ValidationErrors | null {
	const confirmation = group.get('confirmation');
	if (!confirmation) return null;

	const identiques = group.get('newPassword')?.value === confirmation.value;

	// Ne toucher qu'à notre propre clé : `required` et consorts appartiennent
	// au contrôle, les écraser masquerait un champ simplement vide.
	const { mismatch: _retire, ...autres } = confirmation.errors ?? {};
	const erreurs = identiques ? autres : { ...autres, mismatch: true };
	confirmation.setErrors(Object.keys(erreurs).length ? erreurs : null);

	return identiques ? null : { mismatch: true };
}

@Component({
	selector: 'app-change-password',
	imports: [
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		ReactiveFormsModule,
		RouterLink,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './change-password.html',
	styleUrl: './change-password.scss',
})
export class ChangePasswordPage {
	private readonly auth = inject(AuthService);
	private readonly router = inject(Router);
	private readonly notifications = inject(NotificationService);
	private readonly formBuilder = inject(FormBuilder);

	readonly minLength = PASSWORD_MIN_LENGTH;
	readonly submitting = signal(false);
	readonly errorMessage = signal<string | null>(null);
	readonly forced = this.auth.mustChangePassword;

	readonly form = this.formBuilder.nonNullable.group(
		{
			currentPassword: ['', [Validators.required]],
			newPassword: ['', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH)]],
			confirmation: ['', [Validators.required]],
		},
		{ validators: passwordsMatch },
	);

	/**
	 * Ce qui empêche l'envoi, dit en une phrase.
	 *
	 * Les `mat-error` signalent le champ fautif, encore faut-il le voir : sur
	 * un formulaire déroulé, le bouton peut être loin du champ en cause. Ce
	 * résumé s'affiche juste au-dessus du bouton, là où l'on clique.
	 */
	private raisonDuBlocage(): string | null {
		const { currentPassword, newPassword, confirmation } = this.form.controls;

		if (currentPassword.hasError('required')) return 'Indiquez votre mot de passe actuel.';
		if (newPassword.hasError('required')) return 'Choisissez un nouveau mot de passe.';
		if (newPassword.hasError('minlength')) {
			return `Le nouveau mot de passe doit faire au moins ${this.minLength} caractères.`;
		}
		if (confirmation.hasError('required')) return 'Confirmez le nouveau mot de passe.';
		if (confirmation.hasError('mismatch')) {
			return 'Les deux mots de passe saisis ne correspondent pas.';
		}

		return null;
	}

	submit(): void {
		if (this.submitting()) return;

		if (this.form.invalid) {
			this.form.markAllAsTouched();
			this.errorMessage.set(this.raisonDuBlocage());
			return;
		}

		this.submitting.set(true);
		this.errorMessage.set(null);

		const { currentPassword, newPassword } = this.form.getRawValue();

		this.auth.changePassword({ currentPassword, newPassword }).subscribe({
			next: () => {
				this.submitting.set(false);
				// Le serveur a revoque toutes les sessions : il faut se reconnecter.
				this.notifications.success('Mot de passe modifié. Reconnectez-vous avec le nouveau.');
				void this.router.navigate(['/connexion']);
			},
			error: (error: unknown) => {
				this.submitting.set(false);
				this.errorMessage.set(readApiError(error));
			},
		});
	}
}
