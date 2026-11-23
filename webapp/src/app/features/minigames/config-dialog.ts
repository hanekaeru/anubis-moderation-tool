import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
	MAX_MINIGAME_ATTEMPTS,
	MAX_MINIGAME_XP,
	MAX_MINIGAME_XP_STEPS,
	MINIGAME_DEFAULT_OUT_OF_ATTEMPTS_MESSAGE,
	MINIGAME_TYPES,
	MINIGAME_TYPE_EMOJIS,
	MINIGAME_TYPE_LABELS,
	type MinigameConfigDto,
	type MinigameType,
} from '@anubis/shared';
import { MinigamesApi } from '../../core/api/minigames.api';
import { readApiError } from '../../core/error.interceptor';

const SNOWFLAKE = /^\d{17,20}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/** « 60, 40, 20 » : nombres separes par des virgules, des espaces ou des points-virgules. */
function parseXp(value: string): number[] {
	return value
		.split(/[\s,;]+/)
		.filter(Boolean)
		.map(Number);
}

function xpTable(control: AbstractControl<string>): ValidationErrors | null {
	const values = parseXp(control.value ?? '');
	if (!values.length) return { xp: 'Au moins une valeur.' };
	if (values.length > MAX_MINIGAME_XP_STEPS) return { xp: `${MAX_MINIGAME_XP_STEPS} valeurs au plus.` };
	const fautive = values.find((v) => !Number.isInteger(v) || v < 0 || v > MAX_MINIGAME_XP);
	return fautive === undefined ? null : { xp: `« ${fautive} » n'est pas un entier entre 0 et ${MAX_MINIGAME_XP}.` };
}

/**
 * Reglage des mini-jeux : salons, ping, semaine type et baremes.
 *
 * Le dashboard n'a pas de selecteur de salons ni de roles — simplification
 * assumee ailleurs aussi : les identifiants se collent depuis Discord (mode
 * developpeur, « Copier l'identifiant »).
 */
@Component({
	selector: 'app-minigame-config-dialog',
	imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, ReactiveFormsModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>Réglage des mini-jeux</h2>

		<mat-dialog-content>
			<form class="form" [formGroup]="form">
				<h3>Salons et ping</h3>
				<div class="pair">
					<mat-form-field>
						<mat-label>Salon d'annonce</mat-label>
						<input matInput formControlName="announceChannelId" placeholder="Identifiant du salon" />
						<mat-hint>Publications, pings et annonces de fin. Sans lui, rien ne part.</mat-hint>
						@if (form.controls.announceChannelId.invalid) {
							<mat-error>Identifiant Discord invalide.</mat-error>
						}
					</mat-form-field>
					<mat-form-field>
						<mat-label>Salon de jeu</mat-label>
						<input matInput formControlName="playChannelId" placeholder="Identifiant du salon" />
						<mat-hint>Seul salon où /devine répond (fils compris). Vide : partout.</mat-hint>
						@if (form.controls.playChannelId.invalid) {
							<mat-error>Identifiant Discord invalide.</mat-error>
						}
					</mat-form-field>
				</div>
				<div class="pair">
					<mat-form-field>
						<mat-label>Rôle pingé</mat-label>
						<input matInput formControlName="pingRoleId" placeholder="Identifiant du rôle" />
						<mat-hint>Dans un message à part, à l'heure ci-contre. Vide : aucun ping.</mat-hint>
						@if (form.controls.pingRoleId.invalid) {
							<mat-error>Identifiant Discord invalide.</mat-error>
						}
					</mat-form-field>
					<mat-form-field>
						<mat-label>Heure du ping</mat-label>
						<input matInput type="time" formControlName="pingTime" />
						<mat-hint>Heure de Paris. Le jeu, lui, ouvre à minuit.</mat-hint>
					</mat-form-field>
				</div>

				<h3>Semaine type</h3>
				<p class="hint">Pré-remplit le type d'un jour qu'on ouvre dans le calendrier. Ne crée rien tout seul.</p>
				<div class="week" formArrayName="weekTemplate">
					@for (day of weekdays; track $index) {
						<mat-form-field subscriptSizing="dynamic">
							<mat-label>{{ day }}</mat-label>
							<mat-select [formControlName]="$index">
								<mat-option [value]="''">Aucun jeu</mat-option>
								@for (type of types; track type) {
									<mat-option [value]="type">{{ emojis[type] }} {{ typeLabels[type] }}</mat-option>
								}
							</mat-select>
						</mat-form-field>
					}
				</div>

				<h3>Essais et expérience</h3>
				<p class="hint">
					Barèmes par nombre d'essais : la première valeur pour une réponse du premier coup, la dernière
					au-delà. Le héros seul, au jeu du skin, rapporte la moitié — jamais cumulée avec le skin.
				</p>
				<div class="pair">
					<mat-form-field>
						<mat-label>Essais par membre</mat-label>
						<input matInput type="number" formControlName="maxAttempts" min="1" [max]="maxAttempts" />
					</mat-form-field>
					<mat-form-field>
						<mat-label>Vrai ou faux — bonne réponse</mat-label>
						<input matInput type="number" formControlName="trueFalseXp" min="0" [max]="maxXp" />
						<span matTextSuffix>XP</span>
					</mat-form-field>
				</div>
				<div class="triple">
					@for (field of xpFields; track field.key) {
						<mat-form-field>
							<mat-label>{{ field.label }}</mat-label>
							<input matInput [formControlName]="field.key" placeholder="60, 40, 20" />
							<span matTextSuffix>XP</span>
							@if (form.controls[field.key].errors?.['xp']; as message) {
								<mat-error>{{ message }}</mat-error>
							}
						</mat-form-field>
					}
				</div>

				<mat-form-field>
					<mat-label>Message une fois les essais épuisés</mat-label>
					<textarea matInput formControlName="outOfAttemptsMessage" rows="3" [placeholder]="defaultMessage"></textarea>
					<mat-hint>Vide : le texte par défaut. Chaque jeu peut avoir le sien.</mat-hint>
				</mat-form-field>
			</form>

			@if (error(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}
		</mat-dialog-content>

		<mat-dialog-actions align="end">
			<button matButton mat-dialog-close>Annuler</button>
			<button matButton="filled" [disabled]="saving() || form.invalid" (click)="save()">Enregistrer</button>
		</mat-dialog-actions>
	`,
	styles: `
		.form {
			display: flex;
			flex-direction: column;
			gap: var(--space-3);
			max-width: 760px;
			padding-top: 4px;
		}

		h3 {
			margin: var(--space-4) 0 0;
			font-size: 0.95rem;
			font-weight: 500;
		}

		h3:first-child {
			margin-top: 0;
		}

		.pair {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--space-4);
		}

		.triple {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: var(--space-4);
		}

		.week {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
			gap: var(--space-3);
		}

		.hint {
			margin: 0;
			font-size: 0.85rem;
			color: var(--mat-sys-on-surface-variant);
		}

		.error {
			margin: var(--space-3) 0 0;
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-error-container);
			color: var(--mat-sys-on-error-container);
		}

		@media (max-width: 640px) {
			.pair,
			.triple {
				grid-template-columns: 1fr;
			}
		}
	`,
})
export class MinigameConfigDialog {
	private readonly api = inject(MinigamesApi);
	private readonly dialogRef = inject(MatDialogRef<MinigameConfigDialog, MinigameConfigDto>);
	private readonly config = inject<MinigameConfigDto>(MAT_DIALOG_DATA);
	private readonly fb = inject(FormBuilder).nonNullable;

	readonly weekdays = WEEKDAYS;
	readonly types = MINIGAME_TYPES;
	readonly typeLabels: Record<string, string> = MINIGAME_TYPE_LABELS;
	readonly emojis: Record<string, string> = MINIGAME_TYPE_EMOJIS;
	readonly maxAttempts = MAX_MINIGAME_ATTEMPTS;
	readonly maxXp = MAX_MINIGAME_XP;
	readonly defaultMessage = MINIGAME_DEFAULT_OUT_OF_ATTEMPTS_MESSAGE;
	readonly xpFields = [
		{ key: 'heroXp', label: 'Devine le héros' },
		{ key: 'mapXp', label: 'Devine la map' },
		{ key: 'skinXp', label: 'Devine le skin' },
	] as const;

	readonly saving = signal(false);
	readonly error = signal<string | null>(null);

	readonly form = this.fb.group({
		announceChannelId: [this.config.announceChannelId ?? '', [Validators.pattern(SNOWFLAKE)]],
		playChannelId: [this.config.playChannelId ?? '', [Validators.pattern(SNOWFLAKE)]],
		pingRoleId: [this.config.pingRoleId ?? '', [Validators.pattern(SNOWFLAKE)]],
		pingTime: [this.config.pingTime, [Validators.required, Validators.pattern(TIME)]],
		weekTemplate: this.fb.array(this.config.weekTemplate.map((type) => this.fb.control<string>(type ?? ''))),
		maxAttempts: [
			this.config.maxAttempts,
			[Validators.required, Validators.min(1), Validators.max(MAX_MINIGAME_ATTEMPTS)],
		],
		heroXp: [this.config.heroXp.join(', '), [xpTable]],
		mapXp: [this.config.mapXp.join(', '), [xpTable]],
		skinXp: [this.config.skinXp.join(', '), [xpTable]],
		trueFalseXp: [this.config.trueFalseXp, [Validators.required, Validators.min(0), Validators.max(MAX_MINIGAME_XP)]],
		outOfAttemptsMessage: [this.config.outOfAttemptsMessage ?? ''],
	});

	save(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}
		const v = this.form.getRawValue();
		this.saving.set(true);
		this.error.set(null);
		this.api
			.updateConfig({
				announceChannelId: v.announceChannelId.trim() || null,
				playChannelId: v.playChannelId.trim() || null,
				pingRoleId: v.pingRoleId.trim() || null,
				pingTime: v.pingTime,
				weekTemplate: v.weekTemplate.map((type) => (type || null) as MinigameType | null),
				maxAttempts: Math.round(v.maxAttempts),
				heroXp: parseXp(v.heroXp),
				mapXp: parseXp(v.mapXp),
				skinXp: parseXp(v.skinXp),
				trueFalseXp: Math.round(v.trueFalseXp),
				outOfAttemptsMessage: v.outOfAttemptsMessage.trim() || null,
			})
			.subscribe({
				next: (saved) => this.dialogRef.close(saved),
				error: (err) => {
					this.saving.set(false);
					this.error.set(readApiError(err));
				},
			});
	}
}
