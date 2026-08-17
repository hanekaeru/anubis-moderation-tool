import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router } from '@angular/router';
import {
	TOTP_CODE_LENGTH,
	USERNAME_MAX_LENGTH,
	USERNAME_MIN_LENGTH,
	isTwoFactorChallenge,
	type SessionUser,
} from '@anubis/shared';
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

	/**
	 * Defi de second facteur en cours.
	 *
	 * Sa presence fait basculer l'ecran sur la saisie du code : le formulaire
	 * d'identifiants n'a plus rien a demander, et le mot de passe n'est pas
	 * conserve — il a deja ete verifie, seul le defi compte desormais.
	 */
	readonly challengeToken = signal<string | null>(null);

	readonly codeLength = TOTP_CODE_LENGTH;

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

	// Un code de secours est plus long qu'un code temporel : le champ accepte
	// les deux, c'est l'API qui distingue.
	readonly codeForm = this.formBuilder.nonNullable.group({
		code: ['', [Validators.required, Validators.minLength(TOTP_CODE_LENGTH)]],
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
			next: (result) => {
				this.submitting.set(false);

				if (isTwoFactorChallenge(result)) {
					this.challengeToken.set(result.challengeToken);
					return;
				}

				this.onAuthenticated(result.user);
			},
			error: (error: unknown) => {
				this.submitting.set(false);
				this.errorMessage.set(readApiError(error));
			},
		});
	}

	submitCode(): void {
		const challengeToken = this.challengeToken();
		if (!challengeToken || this.codeForm.invalid || this.submitting()) {
			this.codeForm.markAllAsTouched();
			return;
		}

		this.submitting.set(true);
		this.errorMessage.set(null);

		this.auth
			.completeTwoFactorLogin({
				challengeToken,
				code: this.codeForm.getRawValue().code,
			})
			.subscribe({
				next: (user) => {
					this.submitting.set(false);
					this.onAuthenticated(user);
				},
				error: (error: unknown) => {
					this.submitting.set(false);
					this.codeForm.reset({ code: '' });
					this.errorMessage.set(readApiError(error));
				},
			});
	}

	/** Retour au premier ecran : le defi est abandonne, pas mis de cote. */
	cancelTwoFactor(): void {
		this.challengeToken.set(null);
		this.codeForm.reset({ code: '' });
		this.form.controls.password.reset('');
		this.errorMessage.set(null);
	}

	private onAuthenticated(user: SessionUser): void {
		// Un mot de passe provisoire doit etre remplace avant tout le reste.
		if (user.mustChangePassword) {
			void this.router.navigate(['/mot-de-passe']);
			return;
		}

		const redirect = this.route.snapshot.queryParamMap.get('redirect') ?? '/';
		void this.router.navigateByUrl(redirect);
	}
}
