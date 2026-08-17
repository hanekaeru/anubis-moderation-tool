import {
	ChangeDetectionStrategy,
	Component,
	ElementRef,
	OnDestroy,
	afterNextRender,
	inject,
	input,
	model,
	signal,
	viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Editor } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';

/**
 * Editeur de texte riche, pour les articles du wiki.
 *
 * TipTap est employe en mode « headless » : il ne fournit aucune interface, ce
 * qui laisse la barre d'outils etre faite de vrais boutons Material. Un editeur
 * livre avec son propre theme (Quill, CKEditor) aurait impose son apparence au
 * milieu d'une application entierement Material.
 *
 * L'instance n'est pas creee dans le constructeur mais dans `afterNextRender` :
 * TipTap a besoin d'un element du DOM, et le rendu serveur n'en a pas. La
 * detruire dans `ngOnDestroy` n'est pas optionnel — ProseMirror pose des
 * ecouteurs sur le document, qui survivraient a la fermeture de la page.
 *
 * Le HTML produit ici ne fait jamais foi : l'API le renettoie a l'ecriture
 * (`wiki-content.ts`), et c'est elle qui decide de ce qui est stocke.
 *
 * Chaque bouton de la barre annule son `mousedown` : sans cela, le bouton prend
 * le focus au moment ou on l'enfonce, ce qui replie la selection de l'editeur.
 * La commande s'appliquerait alors a un curseur vide, et le texte selectionne
 * ne serait pas mis en forme.
 */
interface OutilBarre {
	readonly icone: string;
	readonly libelle: string;
	/** Nom de la marque ou du noeud TipTap, pour l'etat actif du bouton. */
	readonly actif: string;
	readonly attrs?: Record<string, unknown>;
	readonly action: (editor: Editor) => void;
}

const OUTILS: readonly (OutilBarre | 'separateur')[] = [
	{
		icone: 'format_bold',
		libelle: 'Gras',
		actif: 'bold',
		action: (e) => e.chain().focus().toggleBold().run(),
	},
	{
		icone: 'format_italic',
		libelle: 'Italique',
		actif: 'italic',
		action: (e) => e.chain().focus().toggleItalic().run(),
	},
	{
		icone: 'format_strikethrough',
		libelle: 'Barré',
		actif: 'strike',
		action: (e) => e.chain().focus().toggleStrike().run(),
	},
	{
		icone: 'code',
		libelle: 'Code',
		actif: 'code',
		action: (e) => e.chain().focus().toggleCode().run(),
	},
	'separateur',
	{
		icone: 'title',
		libelle: 'Titre de section',
		actif: 'heading',
		attrs: { level: 2 },
		action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
	},
	{
		icone: 'subtitles',
		libelle: 'Sous-titre',
		actif: 'heading',
		attrs: { level: 3 },
		action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
	},
	'separateur',
	{
		icone: 'format_list_bulleted',
		libelle: 'Liste à puces',
		actif: 'bulletList',
		action: (e) => e.chain().focus().toggleBulletList().run(),
	},
	{
		icone: 'format_list_numbered',
		libelle: 'Liste numérotée',
		actif: 'orderedList',
		action: (e) => e.chain().focus().toggleOrderedList().run(),
	},
	{
		icone: 'format_quote',
		libelle: 'Citation',
		actif: 'blockquote',
		action: (e) => e.chain().focus().toggleBlockquote().run(),
	},
	{
		icone: 'data_object',
		libelle: 'Bloc de code',
		actif: 'codeBlock',
		action: (e) => e.chain().focus().toggleCodeBlock().run(),
	},
	'separateur',
	{
		icone: 'horizontal_rule',
		libelle: 'Séparateur',
		actif: '__jamais__',
		action: (e) => e.chain().focus().setHorizontalRule().run(),
	},
];

@Component({
	selector: 'app-rich-text-editor',
	imports: [MatButtonModule, MatDividerModule, MatIconModule, MatTooltipModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="editor" [class.disabled]="disabled()">
			<div class="toolbar" role="toolbar" aria-label="Mise en forme">
				@for (outil of outils; track $index) {
					@if (outil === 'separateur') {
						<mat-divider vertical />
					} @else {
						<button
							matIconButton
							type="button"
							[disabled]="disabled()"
							[class.active]="estActif(outil)"
							[matTooltip]="outil.libelle"
							(mousedown)="$event.preventDefault()"
							(click)="appliquer(outil)"
						>
							<mat-icon>{{ outil.icone }}</mat-icon>
						</button>
					}
				}

				<mat-divider vertical />

				<button
					matIconButton
					type="button"
					[disabled]="disabled()"
					[class.active]="estActifNom('link')"
					matTooltip="Lien"
					(mousedown)="$event.preventDefault()"
					(click)="basculerLien()"
				>
					<mat-icon>link</mat-icon>
				</button>

				<span class="spacer"></span>

				<button
					matIconButton
					type="button"
					[disabled]="disabled()"
					matTooltip="Annuler"
					(mousedown)="$event.preventDefault()"
					(click)="annuler()"
				>
					<mat-icon>undo</mat-icon>
				</button>
				<button
					matIconButton
					type="button"
					[disabled]="disabled()"
					matTooltip="Rétablir"
					(mousedown)="$event.preventDefault()"
					(click)="retablir()"
				>
					<mat-icon>redo</mat-icon>
				</button>
			</div>

			<div class="surface" #hote></div>
		</div>
	`,
	styles: `
		.editor {
			border: 1px solid var(--mat-sys-outline-variant);
			border-radius: 12px;
			overflow: hidden;
			background: var(--mat-sys-surface);

			&:focus-within {
				border-color: var(--mat-sys-primary);
			}

			&.disabled {
				opacity: 0.6;
			}
		}

		.toolbar {
			display: flex;
			align-items: center;
			gap: 2px;
			flex-wrap: wrap;
			padding: 6px 8px;
			border-bottom: 1px solid var(--mat-sys-outline-variant);
			background: var(--mat-sys-surface-container-low);

			mat-divider {
				height: 20px;
				margin: 0 4px;
			}

			mat-icon {
				font-size: 20px;
				width: 20px;
				height: 20px;
			}

			button.active {
				background: var(--mat-sys-secondary-container);
				color: var(--mat-sys-on-secondary-container);
			}
		}

		.spacer {
			flex: 1;
		}

		.surface {
			padding: 4px 18px;
			max-height: 60vh;
			overflow-y: auto;
		}

		/*
		 * Le contenu est injecte par ProseMirror hors du template Angular :
		 * l'encapsulation de vue ne s'y applique pas, d'ou ::ng-deep. La regle
		 * reste bornee a .surface, donc elle ne fuit pas hors du composant.
		 */
		.surface ::ng-deep .ProseMirror {
			outline: none;
			min-height: 220px;
			color: var(--mat-sys-on-surface);
			line-height: 1.65;

			> * + * {
				margin-top: 0.8em;
			}

			h2 {
				font-size: 1.3rem;
				font-weight: 600;
				margin-top: 1.4em;
			}

			h3 {
				font-size: 1.1rem;
				font-weight: 600;
				margin-top: 1.2em;
			}

			ul,
			ol {
				padding-left: 1.4em;
			}

			blockquote {
				border-left: 3px solid var(--mat-sys-primary);
				padding-left: 14px;
				color: var(--mat-sys-on-surface-variant);
			}

			code {
				background: var(--mat-sys-surface-variant);
				border-radius: 4px;
				padding: 1px 5px;
				font-size: 0.88em;
			}

			pre {
				background: var(--mat-sys-surface-variant);
				border-radius: 8px;
				padding: 12px 14px;
				overflow-x: auto;

				code {
					background: none;
					padding: 0;
				}
			}

			hr {
				border: none;
				border-top: 1px solid var(--mat-sys-outline-variant);
			}

			a {
				color: var(--mat-sys-primary);
			}

			/* Indication de saisie, posee par l'extension Placeholder. */
			p.is-editor-empty:first-child::before {
				content: attr(data-placeholder);
				float: left;
				height: 0;
				pointer-events: none;
				color: var(--mat-sys-on-surface-variant);
			}
		}
	`,
})
export class RichTextEditor implements OnDestroy {
	private readonly hote = viewChild.required<ElementRef<HTMLElement>>('hote');
	private readonly elementRef = inject(ElementRef);

	readonly value = model<string>('');
	readonly disabled = input(false);
	readonly placeholder = input('Rédigez l’article…');

	readonly outils = OUTILS;

	private editor: Editor | null = null;

	/**
	 * Rejoue l'etat de l'editeur apres chaque interaction.
	 *
	 * ProseMirror vit hors d'Angular : aucun de ses changements ne declenche de
	 * detection, et sans ce signal les boutons resteraient figes sur leur etat
	 * initial en `OnPush`.
	 */
	private readonly revision = signal(0);

	constructor() {
		afterNextRender(() => {
			this.editor = new Editor({
				element: this.hote().nativeElement,
				extensions: [
					// `link` se configure **dans** StarterKit : la v3 l'embarque
					// deja, et l'ajouter a cote enregistrait deux fois la meme
					// extension (« Duplicate extension names found »).
					StarterKit.configure({
						heading: { levels: [2, 3] },
						link: {
							openOnClick: false,
							autolink: true,
							// Miroir de la liste de schemes de l'API : autoriser
							// `javascript:` ici ferait proposer un lien que l'API
							// retirerait ensuite sans rien dire.
							protocols: ['http', 'https', 'mailto'],
						},
					}),
					Placeholder.configure({ placeholder: () => this.placeholder() }),
				],
				content: this.value(),
				editable: !this.disabled(),
				onUpdate: ({ editor }) => {
					// `value` est un `model` : l'ecriture remonte au parent. Le
					// HTML brut suffit, l'API le renettoie.
					this.value.set(editor.getHTML());
					this.revision.update((n) => n + 1);
				},
				onSelectionUpdate: () => this.revision.update((n) => n + 1),
				onTransaction: () => this.revision.update((n) => n + 1),
			});
		});
	}

	ngOnDestroy(): void {
		// ProseMirror pose des ecouteurs au niveau du document : sans cette
		// destruction, chaque passage sur la page en laisserait un jeu derriere
		// lui, jusqu'au rechargement de l'onglet.
		this.editor?.destroy();
		this.editor = null;
	}

	/** Remplace le contenu sans passer par la frappe (chargement d'un article). */
	setContent(html: string): void {
		if (!this.editor) return;
		// `emitUpdate: false` : le contenu vient d'etre lu depuis l'API, le
		// signaler comme une modification marquerait le formulaire sale d'entree.
		this.editor.commands.setContent(html, { emitUpdate: false });
		this.revision.update((n) => n + 1);
	}

	estActif(outil: OutilBarre): boolean {
		this.revision();
		if (!this.editor) return false;
		return outil.attrs
			? this.editor.isActive(outil.actif, outil.attrs)
			: this.editor.isActive(outil.actif);
	}

	estActifNom(nom: string): boolean {
		this.revision();
		return this.editor?.isActive(nom) ?? false;
	}

	appliquer(outil: OutilBarre): void {
		if (this.editor) outil.action(this.editor);
	}

	annuler(): void {
		this.editor?.chain().focus().undo().run();
	}

	retablir(): void {
		this.editor?.chain().focus().redo().run();
	}

	/**
	 * Pose ou retire un lien sur la selection.
	 *
	 * `window.prompt` plutot qu'une boite Material : l'ouvrir ferait perdre le
	 * focus a l'editeur, donc la selection sur laquelle le lien doit s'appliquer.
	 * Un dialogue demanderait de memoriser puis restaurer la plage — pour un
	 * champ unique, la disproportion est nette.
	 */
	basculerLien(): void {
		const editor = this.editor;
		if (!editor) return;

		if (editor.isActive('link')) {
			editor.chain().focus().unsetLink().run();
			return;
		}

		const actuel = String(editor.getAttributes('link')['href'] ?? '');
		const saisie = window.prompt('Adresse du lien', actuel || 'https://');
		if (saisie === null) return;

		const url = saisie.trim();
		if (!url) {
			editor.chain().focus().unsetLink().run();
			return;
		}

		editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
	}
}
