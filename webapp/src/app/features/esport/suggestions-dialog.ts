import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import type { EsportMatchDto, EsportWeekDto } from '@anubis/shared';
import { EsportApi } from '../../core/api/esport.api';
import { readApiError } from '../../core/error.interceptor';

export interface SuggestionsDialogData {
	week: EsportWeekDto;
}

/** Un match qui porte une proposition, tel que le dialogue l'affiche. */
interface Ligne {
	match: EsportMatchDto;
	scoreA: number;
	scoreB: number;
	forfeit: boolean;
	/** Le match est deja termine sur un autre score : valider le corrige. */
	correction: boolean;
}

/**
 * Validation groupee des scores proposes par Liquipedia.
 *
 * Ce n'est pas une validation a l'aveugle : chaque score est affiche, et coche
 * un par un. Les **forfaits arrivent decoches** — le score propose n'y est que
 * le minimum qu'il fallait pour gagner, pas un resultat joue, et c'est le cas
 * ou l'on voudra le plus souvent verifier. L'API recoit les scores tels
 * qu'affiches et refuse tout si l'un a change entre-temps.
 */
@Component({
	selector: 'app-esport-suggestions-dialog',
	imports: [MatButtonModule, MatCheckboxModule, MatDialogModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>Valider les scores proposés</h2>

		<mat-dialog-content>
			<p class="intro">
				Chaque score coché termine son match, ou corrige celui déjà saisi, et apparaît dans le
				récapitulatif de la semaine. Décochez ceux que vous préférez reprendre à la main.
			</p>

			<ul class="lignes">
				@for (ligne of lignes; track ligne.match.id) {
					<li [class.decochee]="!coches().has(ligne.match.id)">
						<mat-checkbox [checked]="coches().has(ligne.match.id)" (change)="basculer(ligne.match.id)">
							<span class="equipes">
								{{ ligne.match.teamA?.name ?? 'À déterminer' }}
								<strong class="score">{{ ligne.scoreA }} – {{ ligne.scoreB }}</strong>
								{{ ligne.match.teamB?.name ?? 'À déterminer' }}
							</span>
						</mat-checkbox>
						@if (ligne.forfeit || ligne.correction) {
							<span class="marques">
								@if (ligne.forfeit) {
									<span class="marque forfait">Forfait — score minimal, à vérifier</span>
								}
								@if (ligne.correction) {
									<span class="marque">Corrige {{ ligne.match.scoreA }} – {{ ligne.match.scoreB }}</span>
								}
							</span>
						}
					</li>
				}
			</ul>

			<mat-checkbox [checked]="annoncer()" (change)="annoncer.set(!annoncer())">
				Annoncer aussi chaque résultat dans le salon des résultats
			</mat-checkbox>
			<p class="hint">
				@if (annoncer()) {
					Un message par match validé. Les annonces déjà publiées sont corrigées.
				} @else {
					Les scores n'apparaîtront que dans le récapitulatif. Les annonces déjà publiées sont
					corrigées quoi qu'il arrive.
				}
			</p>

			@if (error(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}
		</mat-dialog-content>

		<mat-dialog-actions align="end">
			<button matButton mat-dialog-close>Annuler</button>
			<button matButton="filled" [disabled]="saving() || !coches().size" (click)="valider()">
				Valider {{ coches().size }} score{{ coches().size > 1 ? 's' : '' }}
			</button>
		</mat-dialog-actions>
	`,
	styles: `
		.intro {
			margin: 0 0 var(--space-5);
			max-width: var(--measure);
			color: var(--mat-sys-on-surface-variant);
		}

		.lignes {
			list-style: none;
			margin: 0 0 var(--space-5);
			padding: 0;
			display: flex;
			flex-direction: column;
			gap: var(--space-2);

			li {
				display: flex;
				flex-direction: column;
				gap: var(--space-1);
				padding: var(--space-2) var(--space-3);
				border: 1px solid var(--mat-sys-outline-variant);
				border-radius: 12px;
				transition: opacity var(--anubis-ease-duration) var(--anubis-ease);
			}

			li.decochee {
				opacity: 0.6;
			}
		}

		.score {
			margin: 0 var(--space-2);
			font-variant-numeric: tabular-nums;
		}

		.marques {
			display: flex;
			flex-wrap: wrap;
			gap: var(--space-2);
			/* Aligne sous le libelle, pas sous la case. */
			padding-left: 40px;
		}

		.marque {
			padding: 2px 10px;
			border-radius: 999px;
			font-size: 0.78rem;
			background: var(--mat-sys-surface-container-high);
			color: var(--mat-sys-on-surface-variant);
		}

		.marque.forfait {
			background: var(--anubis-warning-soft);
			color: var(--anubis-warning-text);
		}

		.hint {
			margin: var(--space-1) 0 0;
			padding-left: 40px;
			font-size: 0.85rem;
			color: var(--mat-sys-on-surface-variant);
		}

		.error {
			margin: var(--space-4) 0 0;
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-error-container);
			color: var(--mat-sys-on-error-container);
		}
	`,
})
export class EsportSuggestionsDialog {
	private readonly api = inject(EsportApi);
	private readonly dialogRef = inject(MatDialogRef<EsportSuggestionsDialog, EsportWeekDto>);
	private readonly data = inject<SuggestionsDialogData>(MAT_DIALOG_DATA);

	readonly lignes: Ligne[] = this.data.week.matches.flatMap((match) =>
		match.suggestion
			? [
					{
						match,
						scoreA: match.suggestion.scoreA,
						scoreB: match.suggestion.scoreB,
						forfeit: match.suggestion.forfeit,
						correction: match.finished,
					},
				]
			: [],
	);

	readonly coches = signal(new Set(this.lignes.filter((l) => !l.forfeit).map((l) => l.match.id)));
	readonly annoncer = signal(false);
	readonly saving = signal(false);
	readonly error = signal<string | null>(null);

	readonly selection = computed(() => this.lignes.filter((l) => this.coches().has(l.match.id)));

	basculer(id: string): void {
		this.coches.update((actuels) => {
			const suivants = new Set(actuels);
			if (!suivants.delete(id)) suivants.add(id);
			return suivants;
		});
	}

	valider(): void {
		const selection = this.selection();
		if (!selection.length) return;

		this.saving.set(true);
		this.error.set(null);
		this.api
			.validateSuggestions(this.data.week.id, {
				matches: selection.map((l) => ({ id: l.match.id, scoreA: l.scoreA, scoreB: l.scoreB })),
				announce: this.annoncer(),
			})
			.subscribe({
				next: (week) => this.dialogRef.close(week),
				error: (err: unknown) => {
					this.saving.set(false);
					this.error.set(readApiError(err));
				},
			});
	}
}
