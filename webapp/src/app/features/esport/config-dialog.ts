import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import {
	ESPORT_REGIONS,
	SNOWFLAKE_PATTERN,
	type EsportConfigDto,
	type EsportRegion,
} from '@anubis/shared';
import { EsportApi } from '../../core/api/esport.api';
import { readApiError } from '../../core/error.interceptor';

const toHex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/** Reglages de l'esport, reserves aux administrateurs (`esport:manage`). */
@Component({
	selector: 'app-esport-config-dialog',
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
		<h2 mat-dialog-title>Réglages esport</h2>

		<mat-dialog-content>
			<form [formGroup]="form" class="form">
				<mat-form-field>
					<mat-label>Salon des récapitulatifs</mat-label>
					<input matInput formControlName="channelId" inputmode="numeric" placeholder="123456789012345678" />
					<mat-hint>Clic droit sur le salon → Copier l'identifiant.</mat-hint>
					@if (form.controls.channelId.hasError('pattern')) {
						<mat-error>Un identifiant Discord est fait de 17 à 20 chiffres.</mat-error>
					}
				</mat-form-field>

				<mat-form-field>
					<mat-label>Salon des résultats (facultatif)</mat-label>
					<input matInput formControlName="resultsChannelId" inputmode="numeric" placeholder="Vide : salon des récapitulatifs" />
					@if (form.controls.resultsChannelId.hasError('pattern')) {
						<mat-error>Un identifiant Discord est fait de 17 à 20 chiffres.</mat-error>
					}
				</mat-form-field>

				<mat-form-field>
					<mat-label>Rôle à mentionner (facultatif)</mat-label>
					<input matInput formControlName="mentionRoleId" inputmode="numeric" placeholder="Un rôle « Esport », jamais @everyone" />
					@if (form.controls.mentionRoleId.hasError('pattern')) {
						<mat-error>Un identifiant Discord est fait de 17 à 20 chiffres.</mat-error>
					}
				</mat-form-field>

				<mat-slide-toggle formControlName="mentionOnPublish">
					Mentionner le rôle à l'envoi du récapitulatif
				</mat-slide-toggle>
				<mat-slide-toggle formControlName="mentionOnResult">
					Mentionner le rôle à chaque résultat
				</mat-slide-toggle>
				<mat-slide-toggle formControlName="spoilerScores">
					Scores en spoiler par défaut (modifiable match par match)
				</mat-slide-toggle>

				<div class="row">
					<mat-form-field class="grow">
						<mat-label>Titre par défaut</mat-label>
						<input matInput formControlName="title" maxlength="200" />
					</mat-form-field>

					<div class="color">
						<label for="esport-color">Couleur</label>
						<input id="esport-color" type="color" formControlName="color" />
					</div>
				</div>

				<h3 class="section">Couleurs des régions</h3>
				<p class="hint">
					Chaque région a son embed dans le récapitulatif, avec sa couleur. La couleur ci-dessus sert aux
					matchs sans région et aux annonces de résultat.
				</p>
				<div class="region-colors" formGroupName="regionColors">
					@for (region of regions; track region.code) {
						<label class="color region">
							<input type="color" [formControlName]="region.code" />
							<span>{{ region.emoji }} {{ region.label }}</span>
						</label>
					}
				</div>
				<div>
					<button matButton type="button" (click)="resetRegionColors()">Rétablir les couleurs par défaut</button>
				</div>

				<h3 class="section">Import PandaScore</h3>
				@if (!data.pandascore.available) {
					<p class="hint warning">
						Aucun jeton PandaScore n'est configuré sur l'API (<code>PANDASCORE_TOKEN</code>) :
						l'import est désactivé, la saisie manuelle reste disponible.
					</p>
				}

				<mat-form-field>
					<mat-label>Ligues PandaScore</mat-label>
					<input matInput formControlName="leagueIds" placeholder="5223" />
					<mat-hint>Identifiants séparés par des virgules. 5223 : Overwatch Champions Series.</mat-hint>
					@if (form.controls.leagueIds.hasError('pattern')) {
						<mat-error>Des nombres séparés par des virgules sont attendus.</mat-error>
					}
				</mat-form-field>

				<mat-form-field>
					<mat-label>Séries suivies (facultatif)</mat-label>
					<input matInput formControlName="series" placeholder="EMEA, North America" />
					<mat-hint>Mots-clés séparés par des virgules. Vide : toutes les séries sont proposées.</mat-hint>
				</mat-form-field>
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
			min-width: 440px;
			padding-top: 4px;
		}

		.row {
			display: flex;
			gap: var(--space-3);
			align-items: flex-start;

			.grow {
				flex: 1;
			}
		}

		.color {
			display: flex;
			flex-direction: column;
			gap: var(--space-1);

			label {
				font-size: 0.75rem;
				color: var(--mat-sys-on-surface-variant);
			}

			input {
				width: 56px;
				height: 48px;
				padding: 2px;
				border: 1px solid var(--mat-sys-outline-variant);
				border-radius: 8px;
				background: none;
				cursor: pointer;
			}
		}

		.region-colors {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
			gap: var(--space-2) var(--space-3);
		}

		.color.region {
			flex-direction: row;
			align-items: center;
			gap: var(--space-2);
			font-size: 0.9rem;
			cursor: pointer;

			input {
				width: 40px;
				height: 32px;
			}
		}

		.section {
			margin: var(--space-3) 0 0;
			font: var(--mat-sys-title-small);
		}

		.hint {
			margin: 0;
			font-size: 0.85rem;
			color: var(--mat-sys-on-surface-variant);

			&.warning {
				color: var(--mat-sys-error);
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
export class EsportConfigDialog {
	private readonly api = inject(EsportApi);
	private readonly dialogRef = inject(MatDialogRef<EsportConfigDialog, EsportConfigDto>);
	readonly data = inject<EsportConfigDto>(MAT_DIALOG_DATA);

	readonly saving = signal(false);
	readonly error = signal<string | null>(null);

	readonly form = inject(FormBuilder).nonNullable.group({
		channelId: [this.data.channelId ?? '', [Validators.pattern(SNOWFLAKE_PATTERN)]],
		resultsChannelId: [this.data.resultsChannelId ?? '', [Validators.pattern(SNOWFLAKE_PATTERN)]],
		mentionRoleId: [this.data.mentionRoleId ?? '', [Validators.pattern(SNOWFLAKE_PATTERN)]],
		mentionOnPublish: [this.data.mentionOnPublish],
		mentionOnResult: [this.data.mentionOnResult],
		spoilerScores: [this.data.spoilerScores],
		title: [this.data.title, [Validators.required, Validators.maxLength(200)]],
		color: [`#${this.data.color.toString(16).padStart(6, '0')}`],
		leagueIds: [
			this.data.pandascore.leagueIds.join(', '),
			[Validators.pattern(/^\s*(\d+\s*([,;\s]\s*\d+\s*)*)?$/)],
		],
		series: [this.data.pandascore.series.join(', ')],
		regionColors: inject(FormBuilder).nonNullable.group(
			Object.fromEntries(
				ESPORT_REGIONS.map((region) => [region.code, [toHex(this.data.regionColors[region.code])]]),
			) as Record<EsportRegion, [string]>,
		),
	});

	readonly regions = ESPORT_REGIONS;

	resetRegionColors(): void {
		this.form.controls.regionColors.setValue(
			Object.fromEntries(ESPORT_REGIONS.map((region) => [region.code, toHex(region.color)])) as Record<
				EsportRegion,
				string
			>,
		);
		this.form.markAsDirty();
	}

	save(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}

		const raw = this.form.getRawValue();
		this.saving.set(true);
		this.error.set(null);

		this.api
			.updateConfig({
				channelId: raw.channelId.trim() || null,
				resultsChannelId: raw.resultsChannelId.trim() || null,
				mentionRoleId: raw.mentionRoleId.trim() || null,
				mentionOnPublish: raw.mentionOnPublish,
				mentionOnResult: raw.mentionOnResult,
				spoilerScores: raw.spoilerScores,
				title: raw.title.trim(),
				color: parseInt(raw.color.slice(1), 16),
				regionColors: Object.fromEntries(
					Object.entries(raw.regionColors).map(([code, hex]) => [code, parseInt(hex.slice(1), 16)]),
				),
				pandascoreLeagueIds: raw.leagueIds
					.split(/[,;\s]+/)
					.filter(Boolean)
					.map(Number),
				pandascoreSeries: raw.series
					.split(/[,;]+/)
					.map((motCle) => motCle.trim())
					.filter(Boolean),
			})
			.subscribe({
				next: (config) => this.dialogRef.close(config),
				error: (err: unknown) => {
					this.saving.set(false);
					this.error.set(readApiError(err));
				},
			});
	}
}
