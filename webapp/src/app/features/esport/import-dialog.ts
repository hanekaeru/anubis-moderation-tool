import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	computed,
	inject,
	signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { interval } from 'rxjs';
import {
	esportDayLabel,
	esportFormatLabel,
	ESPORT_TIME_ZONE,
	MAX_ESPORT_MATCHES_PER_WEEK,
	PANDASCORE_STATUS_LABELS,
	zonedDateKey,
	zonedTimeOfDay,
	type EsportWeekDto,
	type PandascoreMatchDto,
	type PandascoreWeekDto,
} from '@anubis/shared';
import { EsportApi } from '../../core/api/esport.api';
import { readApiError } from '../../core/error.interceptor';
import { FrDatePipe } from '../../shared/pipes/format.pipes';

export interface ImportDialogData {
	week: EsportWeekDto;
}

interface Day {
	key: string;
	label: string;
	matches: PandascoreMatchDto[];
}

/**
 * Import des matchs de la semaine depuis PandaScore.
 *
 * Rien ne part sans un clic : la liste vient du cache de l'API (un appel a
 * PandaScore seulement si la semaine n'a jamais ete recuperee), le staff coche
 * ce qu'il veut, et un match deja importe n'est remplace que s'il est coche
 * de nouveau — ses differences avec PandaScore sous les yeux.
 */
@Component({
	selector: 'app-esport-import-dialog',
	imports: [
		FrDatePipe,
		MatButtonModule,
		MatCheckboxModule,
		MatDialogModule,
		MatIconModule,
		MatProgressBarModule,
		MatSlideToggleModule,
		MatTooltipModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>Importer depuis PandaScore</h2>

		<mat-dialog-content>
			@if (loading()) {
				<mat-progress-bar mode="indeterminate" />
			}

			@if (error(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}

			@if (view(); as v) {
				<div class="toolbar">
					<span class="source">
						Données PandaScore
						@if (v.fetchedAt) {
							récupérées le {{ v.fetchedAt | frDate }}
						}
					</span>
					<span class="spacer"></span>
					<button
						matButton
						[disabled]="loading() || !canRefresh()"
						[matTooltip]="canRefresh() ? 'Un appel à PandaScore' : 'Une actualisation toutes les deux minutes au plus'"
						(click)="refresh()"
					>
						<mat-icon>refresh</mat-icon>
						{{ canRefresh() ? 'Actualiser' : 'Actualisable à ' + refreshTime() }}
					</button>
				</div>

				@if (hiddenCount()) {
					<mat-slide-toggle [checked]="showAll()" (change)="showAll.set($event.checked)">
						Afficher les séries non suivies ({{ hiddenCount() }})
					</mat-slide-toggle>
				}

				@if (v.missing.length) {
					<div class="missing">
						<mat-icon>event_busy</mat-icon>
						<p>
							PandaScore ne place plus cette semaine :
							@for (item of v.missing; track item.matchId; let last = $last) {
								<strong>{{ item.label }}</strong>{{ last ? '' : ', ' }}
							}
							. Match reporté ou annulé : vérifiez-le et corrigez-le à la main.
						</p>
					</div>
				}

				@if (!days().length) {
					<p class="empty">Aucun match PandaScore cette semaine pour les ligues réglées.</p>
				}

				@for (day of days(); track day.key) {
					<h3 class="day">{{ day.label }}</h3>
					<ul class="matches">
						@for (match of day.matches; track match.id) {
							<li [class.done]="match.importedMatchId && !match.differences.length">
								<mat-checkbox
									[checked]="selected().has(match.id)"
									[disabled]="!!match.importedMatchId && !match.differences.length"
									(change)="toggle(match.id, $event.checked)"
								/>
								<span class="time">{{ time(match) }}</span>
								<div class="body">
									<div class="teams">
										<span class="team">
											@if (match.teamA?.logoUrl) {
												<img [src]="match.teamA!.logoUrl" alt="" />
											}
											{{ match.teamA?.name ?? 'À déterminer' }}
										</span>
										<span class="vs">
											@if (match.score) {
												{{ match.score.a }} – {{ match.score.b }}
											} @else {
												vs
											}
										</span>
										<span class="team">
											@if (match.teamB?.logoUrl) {
												<img [src]="match.teamB!.logoUrl" alt="" />
											}
											{{ match.teamB?.name ?? 'À déterminer' }}
										</span>
									</div>
									<div class="meta">
										<span>{{ match.competition }}</span>
										@if (match.tournament) {
											<span>{{ match.tournament }}</span>
										}
										@if (format(match); as label) {
											<span>{{ label }}</span>
										}
										<span class="tag" [attr.data-status]="match.status">{{ statusLabel(match.status) }}</span>
										@if (match.rescheduled) {
											<span class="tag">Horaire déplacé</span>
										}
										@if (match.forfeit) {
											<span class="tag">Forfait</span>
										}
										@if (match.importedMatchId) {
											<span class="tag imported">
												{{ match.differences.length ? 'Importé · diffère de PandaScore' : 'Déjà importé' }}
											</span>
										}
									</div>
									@if (match.differences.length) {
										<ul class="differences">
											@for (difference of match.differences; track difference) {
												<li>{{ difference }}</li>
											}
										</ul>
										<p class="note">Coché, ce match sera remplacé par la version PandaScore (score et spoiler conservés).</p>
									}
								</div>
							</li>
						}
					</ul>
				}
			}
		</mat-dialog-content>

		<mat-dialog-actions>
			@if (overCapacity()) {
				<span class="capacity">Au plus {{ max }} matchs par semaine : il reste {{ freeSlots() }} place(s).</span>
			}
			<span class="spacer"></span>
			<button matButton mat-dialog-close>Annuler</button>
			<button matButton="filled" [disabled]="saving() || !selected().size || overCapacity()" (click)="import()">
				Importer {{ selected().size }} match(s)
			</button>
		</mat-dialog-actions>
	`,
	styles: `
		:host {
			display: block;
		}

		mat-dialog-content {
			display: flex;
			flex-direction: column;
			gap: var(--space-3);
			min-width: 560px;
		}

		.toolbar,
		mat-dialog-actions {
			display: flex;
			align-items: center;
			gap: var(--space-2);
		}

		.spacer {
			flex: 1;
		}

		.source,
		.empty,
		.note,
		.capacity {
			margin: 0;
			font-size: 0.85rem;
			color: var(--mat-sys-on-surface-variant);
		}

		.capacity {
			color: var(--mat-sys-error);
		}

		.day {
			margin: var(--space-2) 0 0;
			font: var(--mat-sys-title-small);
		}

		.matches {
			display: flex;
			flex-direction: column;
			gap: var(--space-1);
			margin: 0;
			padding: 0;
			list-style: none;

			> li {
				display: flex;
				align-items: flex-start;
				gap: var(--space-2);
				padding: var(--space-2);
				border: 1px solid var(--mat-sys-outline-variant);
				border-radius: 8px;

				&.done {
					opacity: 0.6;
				}
			}
		}

		.time {
			padding-top: 10px;
			min-width: 44px;
			font-variant-numeric: tabular-nums;
			font-weight: 500;
		}

		.body {
			display: flex;
			flex-direction: column;
			gap: var(--space-1);
			flex: 1;
			padding-top: 8px;
		}

		.teams {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: var(--space-2);
		}

		.team {
			display: inline-flex;
			align-items: center;
			gap: var(--space-1);
			font-weight: 500;

			img {
				width: 20px;
				height: 20px;
				object-fit: contain;
			}
		}

		.vs {
			color: var(--mat-sys-on-surface-variant);
			font-variant-numeric: tabular-nums;
		}

		.meta {
			display: flex;
			flex-wrap: wrap;
			gap: var(--space-1) var(--space-2);
			font-size: 0.8rem;
			color: var(--mat-sys-on-surface-variant);
		}

		.tag {
			padding: 0 6px;
			border-radius: 4px;
			background: var(--mat-sys-surface-container-high);

			&[data-status='finished'] {
				background: var(--mat-sys-secondary-container);
				color: var(--mat-sys-on-secondary-container);
			}

			&[data-status='canceled'],
			&[data-status='postponed'] {
				background: var(--mat-sys-error-container);
				color: var(--mat-sys-on-error-container);
			}

			&.imported {
				background: var(--mat-sys-tertiary-container);
				color: var(--mat-sys-on-tertiary-container);
			}
		}

		.differences {
			margin: 0;
			padding-left: var(--space-5);
			font-size: 0.85rem;
		}

		.missing {
			display: flex;
			gap: var(--space-2);
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-error-container);
			color: var(--mat-sys-on-error-container);

			p {
				margin: 0;
			}
		}

		.error {
			margin: 0;
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-error-container);
			color: var(--mat-sys-on-error-container);
		}

		@media (max-width: 640px) {
			mat-dialog-content {
				min-width: 0;
			}
		}
	`,
})
export class EsportImportDialog {
	private readonly api = inject(EsportApi);
	private readonly dialogRef = inject(MatDialogRef<EsportImportDialog, EsportWeekDto>);
	readonly data = inject<ImportDialogData>(MAT_DIALOG_DATA);

	readonly max = MAX_ESPORT_MATCHES_PER_WEEK;
	readonly view = signal<PandascoreWeekDto | null>(null);
	readonly loading = signal(true);
	readonly saving = signal(false);
	readonly error = signal<string | null>(null);
	readonly showAll = signal(false);
	readonly selected = signal(new Set<number>());
	/** Horloge du bouton « Actualiser », relue toutes les cinq secondes. */
	private readonly now = signal(Date.now());

	readonly hiddenCount = computed(
		() => this.view()?.matches.filter((match) => !match.followed).length ?? 0,
	);

	readonly days = computed<Day[]>(() => {
		const matches = (this.view()?.matches ?? []).filter(
			(match) => this.showAll() || match.followed || this.selected().has(match.id),
		);
		const days = new Map<string, Day>();
		for (const match of matches) {
			const key = zonedDateKey(new Date(match.scheduledAt), ESPORT_TIME_ZONE);
			const day = days.get(key) ?? { key, label: esportDayLabel(key), matches: [] };
			day.matches.push(match);
			days.set(key, day);
		}
		return [...days.values()];
	});

	readonly canRefresh = computed(() => {
		const at = this.view()?.refreshableAt;
		return !at || new Date(at).getTime() <= this.now();
	});

	readonly refreshTime = computed(() => {
		const at = this.view()?.refreshableAt;
		return at ? zonedTimeOfDay(new Date(at), ESPORT_TIME_ZONE) : '';
	});

	readonly freeSlots = computed(() => Math.max(0, this.max - this.data.week.matches.length));

	/** Seuls les nouveaux matchs prennent une place ; une mise a jour non. */
	readonly overCapacity = computed(() => {
		const nouveaux = (this.view()?.matches ?? []).filter(
			(match) => this.selected().has(match.id) && !match.importedMatchId,
		).length;
		return nouveaux > this.freeSlots();
	});

	constructor() {
		const tick = interval(5_000).subscribe(() => this.now.set(Date.now()));
		inject(DestroyRef).onDestroy(() => tick.unsubscribe());

		this.api.getPandascoreWeek(this.data.week.id).subscribe({
			next: (view) => this.apply(view, true),
			error: (err: unknown) => {
				this.loading.set(false);
				this.error.set(readApiError(err));
			},
		});
	}

	refresh(): void {
		this.loading.set(true);
		this.error.set(null);
		this.api.refreshPandascoreWeek(this.data.week.id).subscribe({
			next: (view) => this.apply(view, false),
			error: (err: unknown) => {
				this.loading.set(false);
				this.error.set(readApiError(err));
			},
		});
	}

	toggle(id: number, checked: boolean): void {
		const next = new Set(this.selected());
		if (checked) next.add(id);
		else next.delete(id);
		this.selected.set(next);
	}

	import(): void {
		this.saving.set(true);
		this.error.set(null);
		this.api.importMatches(this.data.week.id, [...this.selected()]).subscribe({
			next: (week) => this.dialogRef.close(week),
			error: (err: unknown) => {
				this.saving.set(false);
				this.error.set(readApiError(err));
			},
		});
	}

	time(match: PandascoreMatchDto): string {
		return zonedTimeOfDay(new Date(match.scheduledAt), ESPORT_TIME_ZONE);
	}

	format(match: PandascoreMatchDto): string | null {
		return esportFormatLabel(match.format, match.games);
	}

	statusLabel(status: string): string {
		return PANDASCORE_STATUS_LABELS[status] ?? status;
	}

	/**
	 * Au premier affichage, coche les nouveaux matchs des series suivies, sauf
	 * annules ou reportes. Une actualisation garde ce que le staff a coche, en
	 * retirant ce qui a disparu de la semaine.
	 */
	private apply(view: PandascoreWeekDto, first: boolean): void {
		this.view.set(view);
		this.loading.set(false);
		this.now.set(Date.now());

		const ids = new Set(view.matches.map((match) => match.id));
		const next = first
			? new Set(
					view.matches
						.filter(
							(match) =>
								match.followed &&
								!match.importedMatchId &&
								match.status !== 'canceled' &&
								match.status !== 'postponed',
						)
						.map((match) => match.id),
				)
			: new Set([...this.selected()].filter((id) => ids.has(id)));
		this.selected.set(next);
	}
}
