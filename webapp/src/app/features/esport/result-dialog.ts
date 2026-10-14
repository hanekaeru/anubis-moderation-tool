import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import {
	buildEsportResultEmbed,
	ESPORT_TIME_ZONE,
	MAX_ESPORT_SCORE,
	PANDASCORE_STATUS_LABELS,
	zonedTimeOfDay,
	type EsportConfigDto,
	type EsportMatchDto,
	type EsportWeekDto,
	type PandascoreResultSuggestionDto,
} from '@anubis/shared';
import { EsportApi } from '../../core/api/esport.api';
import { readApiError } from '../../core/error.interceptor';
import { FrDatePipe } from '../../shared/pipes/format.pipes';
import { EsportEmbedPreview } from './embed-preview';

export interface ResultDialogData {
	match: EsportMatchDto;
	config: EsportConfigDto;
}

/** Valeurs du select de spoiler : `inherit` suit le reglage du serveur. */
type SpoilerChoice = 'inherit' | 'on' | 'off';

/**
 * Saisie (ou correction) du score.
 *
 * L'apercu montre l'annonce telle qu'elle partira dans le salon des resultats,
 * spoiler compris : c'est le moment ou l'on choisit de cacher ou non le score.
 */
@Component({
	selector: 'app-esport-result-dialog',
	imports: [
		EsportEmbedPreview,
		FrDatePipe,
		MatButtonModule,
		MatIconModule,
		MatDialogModule,
		MatFormFieldModule,
		MatInputModule,
		MatSelectModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>{{ data.match.finished ? 'Corriger le score' : 'Terminer le match' }}</h2>

		<mat-dialog-content>
			@if (data.match.pandascoreId) {
				<div class="pandascore">
					@if (suggestion(); as s) {
						@if (s.score) {
							<p>
								PandaScore : <strong>{{ s.score.a }} – {{ s.score.b }}</strong>
								@if (s.forfeit) {
									(forfait)
								}
								@if (s.fetchedAt) {
									<span class="muted">· données du {{ s.fetchedAt | frDate }}</span>
								}
							</p>
							<button matButton type="button" (click)="useSuggestion()">Utiliser ce score</button>
						} @else {
							<p>
								PandaScore : {{ s.status ? statusLabel(s.status) : 'match introuvable dans la semaine' }}
								@if (s.fetchedAt) {
									<span class="muted">· données du {{ s.fetchedAt | frDate }}</span>
								}
							</p>
							<button matButton type="button" [disabled]="refreshing() || !canRefresh()" (click)="refreshSuggestion()">
								<mat-icon>refresh</mat-icon>
								{{ canRefresh() ? 'Actualiser' : 'Actualisable à ' + refreshTime() }}
							</button>
						}
					} @else {
						<p class="muted">Lecture du score PandaScore…</p>
					}
				</div>
				@if (suggestionError(); as message) {
					<p class="error" role="alert">{{ message }}</p>
				}
			}

			<form [formGroup]="form" class="form">
				<div class="scores">
					<mat-form-field>
						<mat-label>{{ data.match.teamA?.name ?? 'Équipe 1' }}</mat-label>
						<input matInput type="number" formControlName="scoreA" min="0" [max]="max" />
					</mat-form-field>
					<span class="dash">–</span>
					<mat-form-field>
						<mat-label>{{ data.match.teamB?.name ?? 'Équipe 2' }}</mat-label>
						<input matInput type="number" formControlName="scoreB" min="0" [max]="max" />
					</mat-form-field>
				</div>

				<mat-form-field>
					<mat-label>Affichage du score</mat-label>
					<mat-select formControlName="spoiler">
						<mat-option value="inherit">
							Réglage du serveur ({{ data.config.spoilerScores ? 'en spoiler' : 'visible' }})
						</mat-option>
						<mat-option value="on">En spoiler</mat-option>
						<mat-option value="off">Visible</mat-option>
					</mat-select>
				</mat-form-field>

				@if (form.invalid && form.touched) {
					<p class="error">Deux scores entiers entre 0 et {{ max }} sont attendus.</p>
				}
			</form>

			<p class="preview-label">
				{{ data.match.finished ? 'Annonce corrigée' : 'Annonce envoyée dans le salon des résultats' }}
			</p>
			<app-esport-embed-preview [embed]="preview()" />

			@if (error(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}
		</mat-dialog-content>

		<mat-dialog-actions align="end">
			<button matButton mat-dialog-close>Annuler</button>
			<button matButton="filled" [disabled]="saving()" (click)="save()">
				{{ data.match.finished ? 'Corriger' : 'Terminer et annoncer' }}
			</button>
		</mat-dialog-actions>
	`,
	styles: `
		.form {
			display: flex;
			flex-direction: column;
			gap: var(--space-3);
			min-width: 420px;
			padding-top: 4px;
		}

		.scores {
			display: flex;
			align-items: flex-start;
			gap: var(--space-3);

			mat-form-field {
				flex: 1;
			}
		}

		.dash {
			padding-top: 16px;
			font-size: 1.2rem;
		}

		.pandascore {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: var(--space-2);
			margin-bottom: var(--space-3);
			padding: 8px 12px;
			border-radius: 8px;
			background: var(--mat-sys-surface-container-high);

			p {
				flex: 1;
				margin: 0;
			}

			.muted {
				margin-left: var(--space-1);
			}
		}

		.muted {
			font-size: 0.85rem;
			color: var(--mat-sys-on-surface-variant);
		}

		.preview-label {
			margin: var(--space-4) 0 var(--space-2);
			font-size: 0.75rem;
			letter-spacing: 0.08em;
			text-transform: uppercase;
			color: var(--mat-sys-on-surface-variant);
		}

		.error {
			margin: var(--space-2) 0 0;
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
export class EsportResultDialog {
	private readonly api = inject(EsportApi);
	private readonly dialogRef = inject(MatDialogRef<EsportResultDialog, EsportWeekDto>);
	readonly data = inject<ResultDialogData>(MAT_DIALOG_DATA);

	readonly max = MAX_ESPORT_SCORE;
	readonly saving = signal(false);
	readonly error = signal<string | null>(null);
	readonly suggestion = signal<PandascoreResultSuggestionDto | null>(null);
	readonly suggestionError = signal<string | null>(null);
	readonly refreshing = signal(false);

	private readonly scoreValidators = [
		Validators.required,
		Validators.min(0),
		Validators.max(MAX_ESPORT_SCORE),
		Validators.pattern(/^\d+$/),
	];

	readonly form = inject(FormBuilder).nonNullable.group({
		scoreA: [this.data.match.scoreA ?? 0, this.scoreValidators],
		scoreB: [this.data.match.scoreB ?? 0, this.scoreValidators],
		spoiler: [this.toChoice(this.data.match.spoiler)],
	});

	private readonly value = toSignal(this.form.valueChanges, {
		initialValue: this.form.getRawValue(),
	});

	readonly preview = computed(() => {
		const raw = this.value();
		const match = this.data.match;
		return buildEsportResultEmbed(
			{
				teamA: match.teamA,
				teamB: match.teamB,
				competition: match.competition,
				scheduledAt: match.scheduledAt,
				format: match.format,
				bestOf: match.bestOf,
				streamUrl: match.streamUrl,
				pandascoreId: match.pandascoreId,
				finished: true,
				scoreA: Number(raw.scoreA ?? 0),
				scoreB: Number(raw.scoreB ?? 0),
				spoiler: this.fromChoice(raw.spoiler ?? 'inherit'),
			},
			this.data.config,
		);
	});

	constructor() {
		if (this.data.match.pandascoreId) this.loadSuggestion(true);
	}

	statusLabel(status: string): string {
		return PANDASCORE_STATUS_LABELS[status] ?? status;
	}

	canRefresh(): boolean {
		const at = this.suggestion()?.refreshableAt;
		return !at || new Date(at).getTime() <= Date.now();
	}

	refreshTime(): string {
		const at = this.suggestion()?.refreshableAt;
		return at ? zonedTimeOfDay(new Date(at), ESPORT_TIME_ZONE) : '';
	}

	useSuggestion(): void {
		const score = this.suggestion()?.score;
		if (!score) return;
		this.form.patchValue({ scoreA: score.a, scoreB: score.b });
		this.form.markAsDirty();
	}

	/** Un appel a PandaScore pour toute la semaine du match, puis relecture. */
	refreshSuggestion(): void {
		this.refreshing.set(true);
		this.suggestionError.set(null);
		this.api.refreshPandascoreWeek(this.data.match.weekId).subscribe({
			next: () => {
				this.refreshing.set(false);
				this.loadSuggestion(false);
			},
			error: (err: unknown) => {
				this.refreshing.set(false);
				this.suggestionError.set(readApiError(err));
			},
		});
	}

	/**
	 * Le score PandaScore pre-remplit un match pas encore termine ; il ne
	 * remplace jamais un score deja saisi. Rien n'est envoye sans « Terminer ».
	 */
	private loadSuggestion(prefill: boolean): void {
		this.api.getPandascoreResult(this.data.match.id).subscribe({
			next: (suggestion) => {
				this.suggestion.set(suggestion);
				if (prefill && suggestion.score && !this.data.match.finished && this.form.pristine) {
					this.form.patchValue({ scoreA: suggestion.score.a, scoreB: suggestion.score.b });
				}
			},
			error: (err: unknown) => this.suggestionError.set(readApiError(err)),
		});
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
			.setResult(this.data.match.id, {
				scoreA: Number(raw.scoreA),
				scoreB: Number(raw.scoreB),
				spoiler: this.fromChoice(raw.spoiler),
			})
			.subscribe({
				next: (week) => this.dialogRef.close(week),
				error: (err: unknown) => {
					this.saving.set(false);
					this.error.set(readApiError(err));
				},
			});
	}

	private toChoice(spoiler: boolean | null): SpoilerChoice {
		return spoiler === null ? 'inherit' : spoiler ? 'on' : 'off';
	}

	private fromChoice(choice: SpoilerChoice): boolean | null {
		return choice === 'inherit' ? null : choice === 'on';
	}
}
