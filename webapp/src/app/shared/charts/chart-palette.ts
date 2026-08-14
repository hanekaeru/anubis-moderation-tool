import { Injectable, computed, inject } from '@angular/core';
import { ThemeService } from '../../core/theme.service';

/**
 * Jetons graphiques.
 *
 * Les couleurs categorielles sont validees pour la vision des couleurs dans les
 * deux modes, contre les surfaces reelles des cartes (`#12151b` en sombre,
 * `#ffffff` en clair) : separation CVD et vision normale au-dessus des seuils.
 * L'ordre des emplacements fait partie de cette validation — il se respecte, il
 * ne se recycle pas. Au-dela de trois series simultanees, on passe a des petits
 * multiples plutot qu'a une quatrieme teinte.
 *
 * **Toute modification des surfaces du theme oblige a rejouer le validateur**
 * (`scripts/validate_palette.js` de la competence dataviz) : le contraste et la
 * separation ne se verifient que contre la surface sur laquelle on dessine.
 *
 * En mode clair, le vert d'eau reste sous 3:1 face au blanc : tout graphique
 * qui l'emploie doit porter une legende ou des etiquettes lisibles, ce que
 * garantit `ChartCard`.
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
	sequential: [
		'#cde2fb',
		'#9ec5f4',
		'#6da7ec',
		'#3987e5',
		'#256abf',
		'#184f95',
		'#0d366b',
	],
	grid: '#e2e6ec',
	axis: '#cdd3dc',
	mutedInk: '#7a8494',
	primaryInk: '#0f1520',
	secondaryInk: '#4a5567',
	tooltipBackground: '#ffffff',
	tooltipBorder: 'rgba(15, 21, 32, 0.12)',
};

const DARK: ChartTokens = {
	// Memes teintes, re-etagees pour la surface sombre — pas une autre palette.
	series: ['#3987e5', '#d95926', '#199e70'],
	sequential: [
		'#0d366b',
		'#184f95',
		'#256abf',
		'#3987e5',
		'#6da7ec',
		'#9ec5f4',
		'#cde2fb',
	],
	grid: '#242a33',
	axis: '#313945',
	mutedInk: '#6c7482',
	primaryInk: '#e7eaf0',
	secondaryInk: '#9aa3b2',
	tooltipBackground: '#1d222a',
	tooltipBorder: 'rgba(255, 255, 255, 0.10)',
};

@Injectable({ providedIn: 'root' })
export class ChartPalette {
	private readonly theme = inject(ThemeService);

	/**
	 * Le mode suit `ThemeService`, pas `prefers-color-scheme`.
	 *
	 * Interroger directement la preference systeme laissait les graphiques en
	 * sombre apres un basculement manuel en clair : l'interface changeait, les
	 * courbes non. C'est le service qui fait autorite sur le theme affiche.
	 */
	readonly isDark = computed(() => this.theme.current() === 'dark');

	tokens(): ChartTokens {
		return this.isDark() ? DARK : LIGHT;
	}
}
