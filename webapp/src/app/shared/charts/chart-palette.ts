import { Injectable, signal } from '@angular/core';

/**
 * Jetons graphiques.
 *
 * Les couleurs categorielles sont validees pour la vision des couleurs dans les
 * deux modes (separation CVD et vision normale au-dessus des seuils). L'ordre
 * des emplacements fait partie de cette validation : il se respecte, il ne se
 * recycle pas. Au-dela de trois series simultanees, on passe a des petits
 * multiples plutot qu'a une quatrieme teinte.
 *
 * En mode clair, le vert d'eau passe sous 3:1 face a la surface : tout
 * graphique qui l'emploie doit porter une legende ou des etiquettes lisibles,
 * ce que garantit `ChartCard`.
 */
export interface ChartTokens {
	/** Emplacements categoriels, dans l'ordre. */
	series: [string, string, string];
	/** Rampe sequentielle (une seule teinte, clair vers fonce). */
	sequential: string[];
	grid: string;
	axis: string;
	mutedInk: string;
	primaryInk: string;
	secondaryInk: string;
	tooltipBackground: string;
	tooltipBorder: string;
}

const LIGHT: ChartTokens = {
	series: ['#2a78d6', '#eb6834', '#1baf7a'],
	sequential: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
	grid: '#e1e0d9',
	axis: '#c3c2b7',
	mutedInk: '#898781',
	primaryInk: '#0b0b0b',
	secondaryInk: '#52514e',
	tooltipBackground: '#ffffff',
	tooltipBorder: 'rgba(11, 11, 11, 0.10)',
};

const DARK: ChartTokens = {
	// Memes teintes, re-etagees pour la surface sombre — pas une autre palette.
	series: ['#3987e5', '#d95926', '#199e70'],
	sequential: ['#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'],
	grid: '#2c2c2a',
	axis: '#383835',
	mutedInk: '#898781',
	primaryInk: '#ffffff',
	secondaryInk: '#c3c2b7',
	tooltipBackground: '#1f1d24',
	tooltipBorder: 'rgba(255, 255, 255, 0.12)',
};

@Injectable({ providedIn: 'root' })
export class ChartPalette {
	private readonly darkMode = signal(
		typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
	);

	readonly isDark = this.darkMode.asReadonly();

	constructor() {
		if (typeof window === 'undefined') return;

		// Le theme suit la preference systeme : les graphiques doivent basculer
		// sans rechargement, sinon ils restent illisibles jusqu'au refresh.
		window
			.matchMedia('(prefers-color-scheme: dark)')
			.addEventListener('change', (event) => this.darkMode.set(event.matches));
	}

	tokens(): ChartTokens {
		return this.darkMode() ? DARK : LIGHT;
	}
}
