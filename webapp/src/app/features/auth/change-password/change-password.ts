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

/** Verifie que la confirmation correspond au nouveau mot de passe. */
function passwordsMatch(group: AbstractControl): ValidationErrors | null {
	const password = group.get('newPassword')?.value as string;
	const confirmation = group.get('confirmation')?.value as string;
	return password === confirmation ? null : { mismatch: true };
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

	submit(): void {
		if (this.form.invalid || this.submitting()) {
			this.form.markAllAsTouched();
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
