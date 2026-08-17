import {
	ChangeDetectionStrategy,
	Component,
	computed,
	effect,
	inject,
	input,
	signal,
	viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import {
	MAX_WIKI_SUMMARY_LENGTH,
	MAX_WIKI_TITLE_LENGTH,
	Permission,
	WIKI_CATEGORY_ICONS,
	WIKI_CATEGORY_LABELS,
	WIKI_CATEGORY_ORDER,
	WikiCategory,
	type WikiArticleDto,
} from '@anubis/shared';
import { WikiApi } from '../../../core/api/wiki.api';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/notification.service';
import { readApiError } from '../../../core/error.interceptor';
import {
	ConfirmDialog,
	type ConfirmDialogData,
} from '../../../shared/components/confirm-dialog';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RichTextEditor } from '../../../shared/components/rich-text-editor';
import { FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';

/**
 * Article du wiki : lecture et redaction dans le meme ecran.
 *
 * Deux pages separees obligeraient a recharger l'article pour passer de l'une a
 * l'autre, et feraient perdre la position de lecture a chaque correction. Le
 * mode est porte par un signal, pas par la route — sauf pour la creation, qui
 * n'a pas d'article a charger et arrive par `/wiki/nouveau`.
 *
 * Le corps est rendu par `[innerHTML]`, donc repasse par le sanitizer d'Angular.
 * L'API a deja nettoye a l'ecriture ; cette seconde passe couvre le cas d'une
 * donnee ecrite avant que la regle ne soit posee.
 */
@Component({
	selector: 'app-wiki-article',
	imports: [
		FrDatePipe,
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatProgressBarModule,
		MatSelectModule,
		MatSlideToggleModule,
		MatTooltipModule,
		ReactiveFormsModule,
		RelativeTimePipe,
		RichTextEditor,
		RouterLink,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './wiki-article.html',
	styleUrl: './wiki-article.scss',
})
export class WikiArticlePage {
	private readonly wikiApi = inject(WikiApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);
	private readonly dialog = inject(MatDialog);
	private readonly router = inject(Router);
	private readonly auth = inject(AuthService);

	private readonly editor = viewChild(RichTextEditor);

	readonly Permission = Permission;
	readonly categories = WIKI_CATEGORY_ORDER;
	readonly categoryLabels: Record<string, string> = WIKI_CATEGORY_LABELS;
	readonly categoryIcons: Record<string, string> = WIKI_CATEGORY_ICONS;
	readonly maxTitle = MAX_WIKI_TITLE_LENGTH;
	readonly maxSummary = MAX_WIKI_SUMMARY_LENGTH;

	/**
	 * Injectes depuis la route grace a `withComponentInputBinding`.
	 *
	 * `slug` est vide sur `/wiki/nouveau`, ou `creating` vaut `true` : la route
	 * de creation n'a pas d'article a charger.
	 */
	readonly slug = input<string>('');
	readonly creating = input(false);

	readonly loading = signal(true);
	readonly saving = signal(false);
	readonly editing = signal(false);
	readonly article = signal<WikiArticleDto | null>(null);
	readonly errorMessage = signal<string | null>(null);
	readonly notFound = signal(false);

	readonly contentHtml = signal('');

	readonly form = this.formBuilder.nonNullable.group({
		title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(MAX_WIKI_TITLE_LENGTH)]],
		category: [WikiCategory.OTHER as WikiCategory, Validators.required],
		summary: ['', Validators.maxLength(MAX_WIKI_SUMMARY_LENGTH)],
		pinned: [false],
	});

	readonly canWrite = computed(() => this.auth.hasPermission(Permission.WIKI_WRITE));

	readonly title = computed(() => this.article()?.title ?? 'Nouvel article');

	constructor() {
		effect(() => {
			// Le mode edition est ouvert d'emblee en creation : il n'y a rien a
			// lire, et exiger un clic de plus n'apprendrait rien a personne.
			if (this.creating()) {
				this.editing.set(true);
				this.loading.set(false);
				return;
			}

			const slug = this.slug();
			if (slug) this.load(slug);
		});
	}

	private load(slug: string): void {
		this.loading.set(true);
		this.notFound.set(false);

		this.wikiApi.findOne(slug).subscribe({
			next: (article) => {
				this.article.set(article);
				this.contentHtml.set(article.contentHtml);
				this.remplirFormulaire(article);
				this.loading.set(false);
			},
			error: () => {
				this.notFound.set(true);
				this.loading.set(false);
			},
		});
	}

	private remplirFormulaire(article: WikiArticleDto): void {
		this.form.reset({
			title: article.title,
			category: article.category,
			summary: article.summary ?? '',
			pinned: article.pinned,
		});
	}

	startEditing(): void {
		const article = this.article();
		if (article) {
			this.remplirFormulaire(article);
			this.contentHtml.set(article.contentHtml);
			// L'editeur existe deja quand on revient en edition : lui reposer le
			// contenu evite qu'il garde la version abandonnee au precedent essai.
			this.editor()?.setContent(article.contentHtml);
		}

		this.errorMessage.set(null);
		this.editing.set(true);
	}

	cancelEditing(): void {
		if (this.creating()) {
			this.router.navigate(['/wiki']);
			return;
		}

		const article = this.article();
		if (article) {
			this.remplirFormulaire(article);
			this.contentHtml.set(article.contentHtml);
			this.editor()?.setContent(article.contentHtml);
		}

		this.errorMessage.set(null);
		this.editing.set(false);
	}

	save(): void {
		if (this.form.invalid || this.saving()) {
			this.form.markAllAsTouched();
			return;
		}

		const contenu = this.contentHtml();

		// Le controle porte sur le texte, pas sur le HTML : l'editeur renvoie
		// `<p></p>` pour un corps vide, ce qui passerait un test de longueur.
		if (!this.aDuTexte(contenu)) {
			this.errorMessage.set("L'article est vide.");
			return;
		}

		const valeurs = this.form.getRawValue();
		const requete = {
			title: valeurs.title.trim(),
			category: valeurs.category,
			summary: valeurs.summary.trim() || null,
			contentHtml: contenu,
			pinned: valeurs.pinned,
		};

		this.saving.set(true);
		this.errorMessage.set(null);

		const existant = this.article();
		const appel = existant
			? this.wikiApi.update(existant.id, requete)
			: this.wikiApi.create(requete);

		appel.subscribe({
			next: (article) => {
				this.saving.set(false);
				this.article.set(article);
				this.contentHtml.set(article.contentHtml);
				this.editing.set(false);
				this.notifications.success(
					existant ? 'Article enregistré.' : 'Article créé.',
				);

				// La creation change l'adresse : le slug est fabrique par l'API a
				// partir du titre, le client ne peut pas le deviner.
				if (!existant) {
					this.router.navigate(['/wiki', article.slug], { replaceUrl: true });
				}
			},
			error: (error) => {
				this.saving.set(false);
				this.errorMessage.set(readApiError(error));
			},
		});
	}

	remove(): void {
		const article = this.article();
		if (!article) return;

		const data: ConfirmDialogData = {
			title: "Supprimer l'article",
			message: `« ${article.title} » disparaîtra du wiki. La suppression est réversible : l'article est conservé en base.`,
			confirmLabel: 'Supprimer',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.wikiApi.remove(article.id).subscribe({
					next: () => {
						this.notifications.success('Article supprimé.');
						this.router.navigate(['/wiki']);
					},
				});
			});
	}

	/**
	 * Detecte un corps sans texte.
	 *
	 * `DOMParser` plutot qu'une regex : retirer les balises a la main sur du
	 * HTML est le genre de raccourci qui laisse passer exactement ce qu'on
	 * cherchait a exclure.
	 */
	private aDuTexte(html: string): boolean {
		const doc = new DOMParser().parseFromString(html, 'text/html');
		return (doc.body.textContent ?? '').trim().length > 0;
	}
}
