import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from '@anubis/shared';
import { AuthService } from '../../../core/auth/auth.service';
import { readApiError } from '../../../core/error.interceptor';

/**
 * Ecran de connexion.
 *
 * Il n'existe volontairement ni inscription ni recuperation de mot de passe :
 * les comptes sont crees et reinitialises par un administrateur depuis le
 * dashboard.
 */
@Component({
	selector: 'app-login',
	imports: [
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatProgressBarModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './login.html',
	styleUrl: './login.scss',
})
export class LoginPage {
	private readonly auth = inject(AuthService);
	private readonly router = inject(Router);
	private readonly route = inject(ActivatedRoute);
	private readonly formBuilder = inject(FormBuilder);

	readonly submitting = signal(false);
	readonly errorMessage = signal<string | null>(null);
	readonly passwordVisible = signal(false);

	readonly form = this.formBuilder.nonNullable.group({
		username: [
			'',
			[
				Validators.required,
				Validators.minLength(USERNAME_MIN_LENGTH),
				Validators.maxLength(USERNAME_MAX_LENGTH),
			],
		],
		password: ['', [Validators.required]],
	});

	togglePasswordVisibility(): void {
		this.passwordVisible.update((visible) => !visible);
	}

	submit(): void {
		if (this.form.invalid || this.submitting()) {
			this.form.markAllAsTouched();
			return;
		}

		this.submitting.set(true);
		this.errorMessage.set(null);

		this.auth.login(this.form.getRawValue()).subscribe({
			next: (user) => {
				this.submitting.set(false);

				// Un mot de passe provisoire doit etre remplace avant tout le reste.
				if (user.mustChangePassword) {
					void this.router.navigate(['/mot-de-passe']);
					return;
				}

				const redirect = this.route.snapshot.queryParamMap.get('redirect') ?? '/';
				void this.router.navigateByUrl(redirect);
			},
			error: (error: unknown) => {
				this.submitting.set(false);
				this.errorMessage.set(readApiError(error));
			},
		});
	}
}
