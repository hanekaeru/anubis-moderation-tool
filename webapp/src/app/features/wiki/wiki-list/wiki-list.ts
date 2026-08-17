import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';
import {
	Permission,
	WIKI_CATEGORY_ICONS,
	WIKI_CATEGORY_LABELS,
	WIKI_CATEGORY_ORDER,
	type WikiArticleSummaryDto,
	type WikiCategory,
} from '@anubis/shared';
import { WikiApi } from '../../../core/api/wiki.api';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RelativeTimePipe } from '../../../shared/pipes/format.pipes';

interface Section {
	category: WikiCategory;
	label: string;
	icon: string;
	articles: WikiArticleSummaryDto[];
}

/**
 * Sommaire du wiki : les articles ranges par categorie.
 *
 * La recherche est envoyee a l'API plutot que filtree en memoire — elle porte
 * aussi sur le corps des articles, que la liste ne transporte pas.
 */
@Component({
	selector: 'app-wiki-list',
	imports: [
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatChipsModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatProgressBarModule,
		MatTooltipModule,
		ReactiveFormsModule,
		RelativeTimePipe,
		RouterLink,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './wiki-list.html',
	styleUrl: './wiki-list.scss',
})
export class WikiListPage {
	private readonly wikiApi = inject(WikiApi);

	readonly Permission = Permission;
	readonly categories = WIKI_CATEGORY_ORDER;
	readonly categoryLabels: Record<string, string> = WIKI_CATEGORY_LABELS;
	readonly categoryIcons: Record<string, string> = WIKI_CATEGORY_ICONS;

	readonly loading = signal(true);
	readonly articles = signal<WikiArticleSummaryDto[]>([]);
	readonly category = signal<WikiCategory | null>(null);

	readonly searchControl = new FormControl('', { nonNullable: true });

	/** Terme courant, tenu a part pour que `hasFilter` reagisse a la frappe. */
	private readonly terme = signal('');

	readonly sections = computed<Section[]>(() => {
		const parCategorie = this.articles();

		return this.categories
			.map((category) => ({
				category,
				label: WIKI_CATEGORY_LABELS[category],
				icon: WIKI_CATEGORY_ICONS[category],
				articles: parCategorie.filter((article) => article.category === category),
			}))
			// Une categorie sans article n'a rien a montrer : l'afficher vide
			// donnerait l'impression d'un wiki plus fourni qu'il n'est.
			.filter((section) => section.articles.length > 0);
	});

	readonly isEmpty = computed(() => !this.loading() && this.articles().length === 0);

	readonly hasFilter = computed(() => Boolean(this.terme().trim()) || this.category() !== null);

	constructor() {
		// `debounceTime` evite une requete par frappe : sans lui, ecrire
		// « bannissement » en declencherait douze.
		this.searchControl.valueChanges
			.pipe(debounceTime(300), takeUntilDestroyed())
			.subscribe((valeur) => {
				this.terme.set(valeur);
				this.reload();
			});

		this.reload();
	}

	private reload(): void {
		this.loading.set(true);

		this.wikiApi
			.search({
				q: this.terme().trim() || undefined,
				category: this.category() ?? undefined,
			})
			.subscribe({
				next: (articles) => {
					this.articles.set(articles);
					this.loading.set(false);
				},
				error: () => this.loading.set(false),
			});
	}

	selectCategory(category: WikiCategory | null): void {
		this.category.set(this.category() === category ? null : category);
		this.reload();
	}

	resetFilters(): void {
		this.searchControl.setValue('');
		this.category.set(null);
		this.reload();
	}
}
