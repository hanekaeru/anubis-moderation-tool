import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'anubis-theme';

/**
 * Sombre par defaut : seule une preference systeme explicitement claire
 * bascule. Interroger `prefers-color-scheme: dark` ferait basculer en clair
 * tous ceux qui n'ont exprime aucune preference, ce qui est l'inverse du
 * defaut voulu. Doit rester aligne sur le script inline d'`index.html`.
 */
function preferredTheme(): Theme {
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'light' || stored === 'dark') return stored;
	return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Le theme Material 3 unique de `styles.scss` reagit deja a la propriete CSS
 * `color-scheme` (via la fonction `light-dark()` que Material genere) : il
 * suffit de la forcer sur `<html>` pour basculer, sans dupliquer de palette.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
	private readonly theme = signal<Theme>(preferredTheme());

	readonly current = this.theme.asReadonly();

	constructor() {
		this.apply(this.theme());
	}

	toggle(): void {
		this.set(this.theme() === 'dark' ? 'light' : 'dark');
	}

	set(theme: Theme): void {
		this.theme.set(theme);
		this.apply(theme);
		localStorage.setItem(STORAGE_KEY, theme);
	}

	private apply(theme: Theme): void {
		document.documentElement.setAttribute('data-theme', theme);
	}
}
