import type { EChartsOption } from 'echarts';
import type { CategoryCount, HeatmapCell, TimeSeriesPoint } from '@anubis/shared';
import type { ChartTokens } from './chart-palette';

/**
 * Fabriques d'options ECharts.
 *
 * Regroupees ici plutot que dispersees dans les composants : c'est ce qui fait
 * que deux graphiques de deux pages differentes se ressemblent. Les regles
 * communes — grille discrete, axes recessifs, infobulle systematique, marques
 * fines — sont appliquees une seule fois.
 */

const DATE_LABEL = new Intl.DateTimeFormat('fr-FR', {
	day: '2-digit',
	month: 'short',
});

function baseOptions(tokens: ChartTokens): EChartsOption {
	return {
		backgroundColor: 'transparent',
		animationDuration: 400,
		textStyle: {
			fontFamily: 'Roboto, system-ui, "Segoe UI", sans-serif',
			color: tokens.secondaryInk,
		},
		tooltip: {
			backgroundColor: tokens.tooltipBackground,
			borderColor: tokens.tooltipBorder,
			borderWidth: 1,
			textStyle: { color: tokens.primaryInk, fontSize: 12 },
			extraCssText: 'border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.12);',
		},
		grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
	};
}

function categoryAxis(tokens: ChartTokens, labels: string[]) {
	return {
		type: 'category' as const,
		data: labels,
		boundaryGap: false,
		axisLine: { lineStyle: { color: tokens.axis } },
		axisTick: { show: false },
		axisLabel: { color: tokens.mutedInk, fontSize: 11 },
	};
}

function valueAxis(tokens: ChartTokens) {
	return {
		type: 'value' as const,
		axisLine: { show: false },
		axisTick: { show: false },
		axisLabel: { color: tokens.mutedInk, fontSize: 11 },
		// Grille en filet : elle situe sans concurrencer les donnees.
		splitLine: { lineStyle: { color: tokens.grid, width: 1 } },
	};
}

/**
 * Courbe(s) temporelle(s).
 *
 * Une legende apparait des qu'il y a deux series : l'identite ne doit jamais
 * reposer sur la seule couleur.
 */
export function timeSeriesOptions(
	tokens: ChartTokens,
	series: { name: string; points: TimeSeriesPoint[]; area?: boolean }[],
): EChartsOption {
	const labels = (series[0]?.points ?? []).map((point) => DATE_LABEL.format(new Date(point.date)));

	return {
		...baseOptions(tokens),
		color: tokens.series,
		legend:
			series.length > 1
				? {
						top: 0,
						right: 0,
						icon: 'roundRect',
						itemWidth: 10,
						itemHeight: 10,
						textStyle: { color: tokens.secondaryInk, fontSize: 12 },
					}
				: undefined,
		tooltip: {
			...baseOptions(tokens).tooltip,
			// Curseur transversal : lire une date, c'est comparer toutes les series
			// de ce jour-la, pas survoler un point precis.
			trigger: 'axis',
			axisPointer: { type: 'line', lineStyle: { color: tokens.axis } },
		},
		xAxis: categoryAxis(tokens, labels),
		yAxis: valueAxis(tokens),
		series: series.map((entry, index) => ({
			name: entry.name,
			type: 'line',
			smooth: 0.25,
			showSymbol: false,
			symbolSize: 8,
			lineStyle: { width: 2 },
			data: entry.points.map((point) => point.value),
			...(entry.area
				? {
						areaStyle: {
							opacity: 0.12,
							color: tokens.series[index % tokens.series.length],
						},
					}
				: {}),
		})),
	};
}

/**
 * Barres a une seule teinte.
 *
 * La couleur ne code rien ici : c'est l'axe qui nomme les categories. Une
 * teinte par barre laisserait croire a une distinction qui n'existe pas.
 */
export function barOptions(
	tokens: ChartTokens,
	data: CategoryCount[],
	options: { horizontal?: boolean } = {},
): EChartsOption {
	const labels = data.map((entry) => entry.label);
	const values = data.map((entry) => entry.value);
	const horizontal = options.horizontal ?? false;

	const category = {
		type: 'category' as const,
		data: labels,
		axisLine: { lineStyle: { color: tokens.axis } },
		axisTick: { show: false },
		axisLabel: { color: tokens.mutedInk, fontSize: 11 },
	};

	return {
		...baseOptions(tokens),
		tooltip: { ...baseOptions(tokens).tooltip, trigger: 'item' },
		xAxis: horizontal ? valueAxis(tokens) : category,
		yAxis: horizontal ? { ...category, inverse: true } : valueAxis(tokens),
		series: [
			{
				type: 'bar',
				data: values,
				color: tokens.series[0],
				barMaxWidth: 28,
				// Extremite arrondie du cote de la valeur, ancrage carre sur la ligne
				// de base : la barre reste lisible comme une longueur.
				itemStyle: {
					borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
				},
			},
		],
	};
}

/**
 * Carte de chaleur jour de semaine x heure.
 *
 * Encodage sequentiel : une seule teinte, du clair au fonce. L'intensite code
 * une magnitude, jamais une identite.
 */
export function heatmapOptions(
	tokens: ChartTokens,
	cells: HeatmapCell[],
	weekdayLabels: readonly string[],
): EChartsOption {
	const max = cells.reduce((peak, cell) => Math.max(peak, cell.value), 0);
	const hours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));

	return {
		...baseOptions(tokens),
		grid: { left: 8, right: 8, top: 8, bottom: 48, containLabel: true },
		tooltip: {
			...baseOptions(tokens).tooltip,
			trigger: 'item',
			formatter: (params: unknown) => {
				const point = params as { value: [number, number, number] };
				const [hour, weekday, value] = point.value;
				return `${weekdayLabels[weekday]} ${String(hour).padStart(2, '0')}h<br/><b>${value}</b> message(s)`;
			},
		},
		xAxis: {
			type: 'category',
			data: hours,
			splitArea: { show: false },
			axisLine: { lineStyle: { color: tokens.axis } },
			axisTick: { show: false },
			axisLabel: { color: tokens.mutedInk, fontSize: 10, interval: 1 },
		},
		yAxis: {
			type: 'category',
			data: [...weekdayLabels],
			inverse: true,
			splitArea: { show: false },
			axisLine: { lineStyle: { color: tokens.axis } },
			axisTick: { show: false },
			axisLabel: { color: tokens.mutedInk, fontSize: 11 },
		},
		visualMap: {
			min: 0,
			max: Math.max(max, 1),
			calculable: false,
			orient: 'horizontal',
			left: 'center',
			bottom: 0,
			itemWidth: 12,
			itemHeight: 120,
			textStyle: { color: tokens.mutedInk, fontSize: 11 },
			inRange: { color: tokens.sequential },
		},
		series: [
			{
				type: 'heatmap',
				data: cells.map((cell) => [cell.hour, cell.weekday, cell.value]),
				// Filet de surface entre les cases : sans lui, deux cases voisines de
				// valeur proche se fondent l'une dans l'autre.
				itemStyle: { borderColor: 'transparent', borderWidth: 2 },
				emphasis: { itemStyle: { borderColor: tokens.primaryInk, borderWidth: 1 } },
			},
		],
	};
}
