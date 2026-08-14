import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { interval, startWith, switchMap } from 'rxjs';
import type { StatusDto } from '@anubis/shared';
import { StatusApi } from '../../core/api/status.api';
import { StatCard } from '../../shared/components/stat-card';
import { DurationPipe, FrDatePipe, RelativeTimePipe } from '../../shared/pipes/format.pipes';

/** La page est un tableau de bord d'exploitation : elle doit vieillir vite. */
const POLL_INTERVAL_MS = 15_000;

@Component({
	selector: 'app-status',
	imports: [
		DurationPipe,
		FrDatePipe,
		MatCardModule,
		MatIconModule,
		MatProgressBarModule,
		RelativeTimePipe,
		StatCard,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './status.html',
	styleUrl: './status.scss',
})
export class StatusPage {
	private readonly statusApi = inject(StatusApi);

	readonly loading = signal(true);
	readonly status = signal<StatusDto | null>(null);

	readonly bot = computed(() => this.status()?.bot ?? null);
	readonly problems = computed(() => this.status()?.problems ?? []);

	/** Etat global : le pire des problemes remontes, ou "operationnel" s'il n'y en a aucun. */
	readonly overall = computed<'ok' | 'warning' | 'critical'>(() => {
		const problems = this.problems();
		if (problems.some((problem) => problem.severity === 'critical')) return 'critical';
		if (problems.length > 0) return 'warning';
		return 'ok';
	});

	readonly overallLabel = computed(() => {
		switch (this.overall()) {
			case 'critical':
				return 'Incident en cours';
			case 'warning':
				return 'Fonctionnement dégradé';
			default:
				return 'Tout est opérationnel';
		}
	});

	readonly overallIcon = computed(() => {
		switch (this.overall()) {
			case 'critical':
				return 'error';
			case 'warning':
				return 'warning';
			default:
				return 'check_circle';
		}
	});

	constructor() {
		interval(POLL_INTERVAL_MS)
			.pipe(
				startWith(0),
				switchMap(() => this.statusApi.get()),
				takeUntilDestroyed(),
			)
			.subscribe({
				next: (status) => {
					this.status.set(status);
					this.loading.set(false);
				},
				error: () => this.loading.set(false),
			});
	}

	/** `—` plutot que `0 ms` : une latence inconnue n'est pas une latence nulle. */
	pingLabel(value: number | null | undefined): string {
		return value === null || value === undefined ? '—' : `${value} ms`;
	}
}
