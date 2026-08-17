import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
	TOTP_CODE_LENGTH,
	type TwoFactorSetupResponse,
	type TwoFactorStatus,
} from '@anubis/shared';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/notification.service';
import { readApiError } from '../../../core/error.interceptor';
import { FrDatePipe } from '../../../shared/pipes/format.pipes';

/**
 * Double authentification du compte connecte.
 *
 * L'activation se fait en deux temps : la preparation genere le secret et le QR
 * code sans rien activer, et seul un premier code valide met la protection en
 * service. Sans ce second temps, un QR mal scanne fermerait le compte.
 *
 * Les codes de secours ne sont montres **qu'une fois** : l'API ne les garde que
 * haches et ne peut plus les reafficher, seulement en generer de nouveaux.
 */
@Component({
	selector: 'app-two-factor',
	imports: [
		FrDatePipe,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatProgressBarModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './two-factor.html',
	styleUrl: './two-factor.scss',
})
export class TwoFactorPage {
	private readonly auth = inject(AuthService);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);

	readonly codeLength = TOTP_CODE_LENGTH;

	readonly loading = signal(true);
	readonly busy = signal(false);
	readonly status = signal<TwoFactorStatus | null>(null);
	readonly setup = signal<TwoFactorSetupResponse | null>(null);
	/** Codes affiches une seule fois, juste apres leur generation. */
	readonly recoveryCodes = signal<string[] | null>(null);
	readonly errorMessage = signal<string | null>(null);

	readonly enabled = computed(() => this.status()?.enabled ?? false);

	/**
	 * Coupee sur ce deploiement (`TWO_FACTOR_ENABLED=false` cote API).
	 *
	 * La page reste atteignable — elle est dans les favoris de qui l'a deja
	 * ouverte — mais elle dit alors ce qui se passe au lieu de proposer une
	 * activation qui serait refusee.
	 */
	readonly unavailable = computed(() => this.status()?.available === false);

	readonly activationForm = this.formBuilder.nonNullable.group({
		code: ['', [Validators.required, Validators.minLength(TOTP_CODE_LENGTH)]],
	});

	readonly disableForm = this.formBuilder.nonNullable.group({
		password: ['', [Validators.required]],
		code: ['', [Validators.required, Validators.minLength(TOTP_CODE_LENGTH)]],
	});

	readonly regenerateForm = this.formBuilder.nonNullable.group({
		code: ['', [Validators.required, Validators.minLength(TOTP_CODE_LENGTH)]],
	});

	constructor() {
		this.reload();
	}

	private reload(): void {
		this.loading.set(true);
		this.auth.twoFactorStatus().subscribe({
			next: (status) => {
				this.status.set(status);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}

	prepare(): void {
		this.busy.set(true);
		this.errorMessage.set(null);

		this.auth.prepareTwoFactor().subscribe({
			next: (setup) => {
				this.setup.set(setup);
				this.busy.set(false);
			},
			error: (error: unknown) => {
				this.busy.set(false);
				this.errorMessage.set(readApiError(error));
			},
		});
	}

	/** Abandonne la configuration en cours : le secret enregistre ne protege rien. */
	cancelSetup(): void {
		this.setup.set(null);
		this.activationForm.reset({ code: '' });
		this.errorMessage.set(null);
	}

	enable(): void {
		if (this.activationForm.invalid || this.busy()) {
			this.activationForm.markAllAsTouched();
			return;
		}

		this.busy.set(true);
		this.errorMessage.set(null);

		this.auth.enableTwoFactor(this.activationForm.getRawValue().code).subscribe({
			next: (response) => {
				this.busy.set(false);
				this.setup.set(null);
				this.activationForm.reset({ code: '' });
				this.recoveryCodes.set(response.codes);
				this.notifications.success('Double authentification activée.');
				this.reload();
			},
			error: (error: unknown) => {
				this.busy.set(false);
				this.activationForm.reset({ code: '' });
				this.errorMessage.set(readApiError(error));
			},
		});
	}

	disable(): void {
		if (this.disableForm.invalid || this.busy()) {
			this.disableForm.markAllAsTouched();
			return;
		}

		this.busy.set(true);
		this.errorMessage.set(null);

		this.auth.disableTwoFactor(this.disableForm.getRawValue()).subscribe({
			next: () => {
				this.busy.set(false);
				this.disableForm.reset({ password: '', code: '' });
				this.recoveryCodes.set(null);
				this.notifications.success('Double authentification désactivée.');
				this.reload();
			},
			error: (error: unknown) => {
				this.busy.set(false);
				this.disableForm.patchValue({ code: '' });
				this.errorMessage.set(readApiError(error));
			},
		});
	}

	regenerate(): void {
		if (this.regenerateForm.invalid || this.busy()) {
			this.regenerateForm.markAllAsTouched();
			return;
		}

		this.busy.set(true);
		this.errorMessage.set(null);

		this.auth.regenerateRecoveryCodes(this.regenerateForm.getRawValue().code).subscribe({
			next: (response) => {
				this.busy.set(false);
				this.regenerateForm.reset({ code: '' });
				this.recoveryCodes.set(response.codes);
				this.notifications.success('Nouveaux codes de secours générés.');
				this.reload();
			},
			error: (error: unknown) => {
				this.busy.set(false);
				this.regenerateForm.reset({ code: '' });
				this.errorMessage.set(readApiError(error));
			},
		});
	}

	dismissCodes(): void {
		this.recoveryCodes.set(null);
	}

	/**
	 * Copie les codes dans le presse-papiers.
	 *
	 * `navigator.clipboard` peut etre absent (contexte non securise) : l'echec
	 * est signale plutot que silencieux, sinon on croirait avoir copie des codes
	 * qu'on ne reverra jamais.
	 */
	copyCodes(): void {
		const codes = this.recoveryCodes();
		if (!codes) return;

		navigator.clipboard
			?.writeText(codes.join('\n'))
			.then(() => this.notifications.success('Codes copiés.'))
			.catch(() =>
				this.notifications.error('Copie impossible : notez-les manuellement.'),
			);
	}
}
