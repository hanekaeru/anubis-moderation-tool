import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';

/**
 * Enveloppe commune a tous les graphiques : titre, hauteur, etat vide.
 *
 * Un graphique sans donnees affiche un message plutot qu'une zone blanche —
 * c'est la difference entre "rien a montrer" et "quelque chose est casse".
 */
@Component({
	selector: 'app-chart-card',
	imports: [MatCardModule, NgxEchartsDirective],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<mat-card appearance="outlined" class="chart-card">
			<mat-card-header>
				<mat-card-title>{{ title() }}</mat-card-title>
				@if (subtitle()) {
					<mat-card-subtitle>{{ subtitle() }}</mat-card-subtitle>
				}
			</mat-card-header>
			<mat-card-content>
				@if (hasData()) {
					<div echarts [options]="options()" [style.height.px]="height()" class="chart"></div>
				} @else {
					<p class="empty" [style.height.px]="height()">Aucune donnée sur cette période.</p>
				}
			</mat-card-content>
		</mat-card>
	`,
	styles: `
		.chart-card {
			height: 100%;
		}

		.chart {
			width: 100%;
		}

		.empty {
			display: flex;
			align-items: center;
			justify-content: center;
			margin: 0;
			color: var(--mat-sys-on-surface-variant);
			font-size: 0.9rem;
		}
	`,
})
export class ChartCard {
	readonly title = input.required<string>();
	readonly subtitle = input<string>();
	readonly options = input.required<EChartsOption>();
	readonly height = input(280);
	/** Laisse le composant afficher l'etat vide plutot qu'un graphique a zero. */
	readonly hasData = input(true);
}
