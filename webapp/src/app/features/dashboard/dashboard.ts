import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import {
  SANCTION_TYPE_LABELS,
  STATS_PERIOD_LABELS,
  TICKET_STATUS_LABELS,
  type DashboardOverview,
  type StatsPeriod,
  type TicketStatus,
} from '@anubis/shared';
import { StatsApi } from '../../core/api/stats.api';
import { ChartCard } from '../../shared/charts/chart-card';
import { ChartPalette } from '../../shared/charts/chart-palette';
import { barOptions, timeSeriesOptions } from '../../shared/charts/chart-options';
import { MemberAvatar } from '../../shared/components/member-avatar';
import { StatCard } from '../../shared/components/stat-card';
import { DurationPipe, RelativeTimePipe } from '../../shared/pipes/format.pipes';

@Component({
  selector: 'app-dashboard',
  imports: [
    ChartCard,
    DurationPipe,
    MatButtonToggleModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    MemberAvatar,
    RelativeTimePipe,
    RouterLink,
    StatCard,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardPage {
  private readonly statsApi = inject(StatsApi);
  private readonly palette = inject(ChartPalette);

  readonly periodLabels = STATS_PERIOD_LABELS;
  readonly periods = Object.keys(STATS_PERIOD_LABELS) as StatsPeriod[];
  readonly sanctionLabels = SANCTION_TYPE_LABELS;

  readonly period = signal<StatsPeriod>('30d');
  readonly loading = signal(true);
  readonly overview = signal<DashboardOverview | null>(null);

  /**
   * Arrivees et departs sur le meme graphique : c'est leur ecart qui informe,
   * et deux graphes cote a cote obligeraient a comparer deux echelles.
   */
  readonly membershipChart = computed(() => {
    const data = this.overview();
    const tokens = this.palette.tokens();
    if (!data) return {};

    return timeSeriesOptions(tokens, [
      { name: 'Arrivees', points: data.joinsPerDay, area: true },
      { name: 'Departs', points: data.leavesPerDay },
    ]);
  });

  readonly messagesChart = computed(() => {
    const data = this.overview();
    const tokens = this.palette.tokens();
    if (!data) return {};

    return timeSeriesOptions(tokens, [
      { name: 'Messages', points: data.messagesPerDay, area: true },
    ]);
  });

  readonly warningsChart = computed(() => {
    const data = this.overview();
    const tokens = this.palette.tokens();
    if (!data) return {};

    return timeSeriesOptions(tokens, [
      { name: 'Avertissements', points: data.warningsPerDay },
    ]);
  });

  readonly sanctionsChart = computed(() => {
    const data = this.overview();
    const tokens = this.palette.tokens();
    if (!data) return {};

    return barOptions(
      tokens,
      data.sanctionsByType.map((entry) => ({
        ...entry,
        label: this.sanctionLabels[entry.key as keyof typeof SANCTION_TYPE_LABELS] ?? entry.label,
      })),
    );
  });

  readonly ticketsChart = computed(() => {
    const data = this.overview();
    const tokens = this.palette.tokens();
    if (!data) return {};

    return barOptions(
      tokens,
      data.ticketsByStatus.map((entry) => ({
        ...entry,
        label: TICKET_STATUS_LABELS[entry.key as TicketStatus] ?? entry.label,
      })),
    );
  });

  readonly hasMembershipData = computed(() =>
    this.hasValues(this.overview()?.joinsPerDay) ||
    this.hasValues(this.overview()?.leavesPerDay),
  );
  readonly hasMessageData = computed(() =>
    this.hasValues(this.overview()?.messagesPerDay),
  );
  readonly hasWarningData = computed(() =>
    this.hasValues(this.overview()?.warningsPerDay),
  );

  constructor() {
    this.load();
  }

  changePeriod(period: StatsPeriod): void {
    this.period.set(period);
    this.load();
  }

  private hasValues(points: { value: number }[] | undefined): boolean {
    return (points ?? []).some((point) => point.value > 0);
  }

  private load(): void {
    this.loading.set(true);

    this.statsApi.overview(this.period()).subscribe({
      next: (data) => {
        this.overview.set(data);
        this.loading.set(false);
      },
      // L'intercepteur d'erreurs a deja notifie : on se contente de sortir
      // de l'etat de chargement pour ne pas figer la page.
      error: () => this.loading.set(false),
    });
  }
}
