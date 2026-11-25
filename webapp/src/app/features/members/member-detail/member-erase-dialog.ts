import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { MemberErasureResult } from '@anubis/shared';
import { MembersApi } from '../../../core/api/members.api';
import { readApiError } from '../../../core/error.interceptor';

export interface MemberEraseDialogData {
	userId: string;
	memberLabel: string;
}

/**
 * Effacement RGPD. L'identifiant se **retape** : c'est la seule action du
 * dashboard qui ne se defait pas, et un clic distrait ne doit pas suffire.
 * L'API refait la meme verification.
 */
@Component({
	selector: 'app-member-erase-dialog',
	imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>Effacer les données de {{ data.memberLabel }}</h2>

		<mat-dialog-content>
			<p>
				À faire uniquement sur demande de la personne. Tout ce que la base sait d'elle est supprimé :
				messages comptés, XP, tickets, avertissements, sanctions, notes, historique des noms, parties…
			</p>
			<p>
				<strong>Restent</strong>, comme l'annonce la politique de confidentialité : ses
				<strong>bannissements</strong> et l'<strong>empreinte de son compte Battle.net</strong> (sans le
				BattleTag), pour qu'un compte banni ou déjà lié ne revienne pas sans antécédent. Son compte n'est
				alors gardé qu'anonymisé.
			</p>
			<p class="warning">
				Irréversible. Pensez à exporter ses données d'abord si elle les a demandées. Si elle est encore
				sur le serveur, le bot recommencera à compter son activité à partir de maintenant.
			</p>

			<mat-form-field class="full">
				<mat-label>Retapez l'identifiant {{ data.userId }}</mat-label>
				<input matInput [ngModel]="saisie()" (ngModelChange)="saisie.set($event)" autocomplete="off" />
			</mat-form-field>

			@if (error(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}
		</mat-dialog-content>

		<mat-dialog-actions align="end">
			<button matButton mat-dialog-close>Annuler</button>
			<button matButton="filled" class="danger" [disabled]="!confirme() || saving()" (click)="effacer()">
				Effacer définitivement
			</button>
		</mat-dialog-actions>
	`,
	styles: `
		mat-dialog-content {
			display: flex;
			flex-direction: column;
			gap: var(--space-4);
			max-width: 560px;
		}

		p {
			margin: 0;
			line-height: 1.5;
		}

		.full {
			width: 100%;
		}

		.warning {
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--anubis-warning-soft);
			color: var(--anubis-warning-text);
		}

		.error {
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-error-container);
			color: var(--mat-sys-on-error-container);
		}

		.danger:not([disabled]) {
			background: var(--mat-sys-error);
			color: var(--mat-sys-on-error);
		}
	`,
})
export class MemberEraseDialog {
	private readonly api = inject(MembersApi);
	private readonly dialogRef = inject(MatDialogRef<MemberEraseDialog, MemberErasureResult>);
	readonly data = inject<MemberEraseDialogData>(MAT_DIALOG_DATA);

	readonly saisie = signal('');
	readonly saving = signal(false);
	readonly error = signal<string | null>(null);
	readonly confirme = computed(() => this.saisie().trim() === this.data.userId);

	effacer(): void {
		if (!this.confirme()) return;
		this.saving.set(true);
		this.error.set(null);
		this.api.eraseData(this.data.userId, { confirmation: this.saisie().trim() }).subscribe({
			next: (result) => this.dialogRef.close(result),
			error: (err: unknown) => {
				this.saving.set(false);
				this.error.set(readApiError(err));
			},
		});
	}
}
