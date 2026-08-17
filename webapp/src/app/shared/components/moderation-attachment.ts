import {
	ChangeDetectionStrategy,
	Component,
	computed,
	effect,
	inject,
	input,
	output,
	signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { ModerationAttachmentRef } from '@anubis/shared';
import { ModerationApi, type ModerationTarget } from '../../core/api/moderation.api';

/**
 * Piece jointe d'un avertissement ou d'une sanction : image affichee en
 * vignette, tout autre fichier en lien de telechargement.
 *
 * Meme contrainte que pour les tickets (`ticket-attachment.ts`) : les octets
 * sont derriere le garde JWT, donc charges en blob puis exposes par une URL
 * objet — un `<img src>` direct ne porterait pas l'en-tete d'autorisation.
 *
 * Une piece marquee `spoiler` reste derriere un voile tant que le moderateur
 * ne l'a pas leve. Le voile n'est pas une regle d'acces : les octets sont
 * charges comme les autres, et qui voit la decision peut voir la piece. Il
 * evite seulement qu'une image penible s'impose au premier coup d'oeil sur une
 * fiche parcourue pour tout autre motif. Le choix vaut pour un affichage : il
 * n'est pas memorise, revenir sur la fiche remet le voile.
 */
@Component({
	selector: 'app-moderation-attachment',
	imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="wrapper">
			@if (masked()) {
				<button type="button" class="veil" (click)="reveal()">
					<mat-icon>visibility_off</mat-icon>
					<span class="veil-label">Preuve sensible</span>
					<span class="veil-hint">{{ attachment().fileName }} · {{ sizeLabel() }}</span>
					<span class="veil-action">Cliquer pour afficher</span>
				</button>
			} @else if (objectUrl(); as url) {
				@if (isImage()) {
					<a [href]="url" target="_blank" rel="noopener" class="preview">
						<img [src]="url" [alt]="attachment().fileName" />
					</a>
				} @else {
					<a [href]="url" [download]="attachment().fileName" class="file-chip">
						<mat-icon>{{ icon() }}</mat-icon>
						<span>{{ attachment().fileName }}</span>
						<span class="size">{{ sizeLabel() }}</span>
					</a>
				}

				@if (attachment().spoiler) {
					<button
						matIconButton
						class="rehide"
						matTooltip="Masquer à nouveau"
						(click)="hide()"
					>
						<mat-icon>visibility_off</mat-icon>
					</button>
				}
			} @else if (failed()) {
				<span class="file-chip error">
					<mat-icon>broken_image</mat-icon>
					{{ attachment().fileName }}
				</span>
			} @else {
				<span class="file-chip loading">
					<mat-spinner diameter="16" />
					{{ attachment().fileName }}
				</span>
			}

			@if (removable()) {
				<button
					matIconButton
					class="remove"
					matTooltip="Supprimer la pièce jointe"
					(click)="remove.emit(attachment().id)"
				>
					<mat-icon>close</mat-icon>
				</button>
			}
		</div>
	`,
	styles: `
		.wrapper {
			display: inline-flex;
			align-items: center;
			gap: 2px;
		}

		.preview img {
			display: block;
			max-width: 220px;
			max-height: 180px;
			border-radius: 8px;
			object-fit: cover;
		}

		.file-chip {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 4px 10px;
			border-radius: 999px;
			background: var(--mat-sys-surface-variant);
			color: var(--mat-sys-on-surface-variant);
			font-size: 0.82rem;
			text-decoration: none;

			mat-icon {
				font-size: 18px;
				width: 18px;
				height: 18px;
			}
		}

		.size {
			opacity: 0.7;
			font-size: 0.75rem;
		}

		.file-chip.error {
			color: var(--mat-sys-error);
		}

		.remove mat-icon,
		.rehide mat-icon {
			font-size: 18px;
			width: 18px;
			height: 18px;
		}

		.veil {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 2px;
			width: 220px;
			min-height: 120px;
			padding: 12px;
			border: 1px dashed var(--mat-sys-outline);
			border-radius: 8px;
			background: var(--mat-sys-surface-variant);
			color: var(--mat-sys-on-surface-variant);
			font: inherit;
			text-align: center;
			cursor: pointer;

			&:hover,
			&:focus-visible {
				background: var(--mat-sys-surface-container-highest);
			}
		}

		.veil-label {
			font-size: 0.85rem;
			font-weight: 500;
		}

		.veil-hint {
			max-width: 100%;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-size: 0.72rem;
			opacity: 0.75;
		}

		.veil-action {
			margin-top: 4px;
			font-size: 0.72rem;
			color: var(--mat-sys-primary);
		}
	`,
})
export class ModerationAttachment {
	private readonly moderationApi = inject(ModerationApi);

	readonly kind = input.required<ModerationTarget>();
	readonly targetId = input.required<string>();
	readonly attachment = input.required<ModerationAttachmentRef>();
	/** Affiche la croix de suppression ; l'appelant decide s'il y a droit. */
	readonly removable = input(false);

	readonly remove = output<string>();

	readonly objectUrl = signal<string | null>(null);
	readonly failed = signal(false);

	/** Voile leve pour cet affichage. Remis a chaque changement de piece. */
	private readonly revealed = signal(false);

	readonly masked = computed(() => this.attachment().spoiler && !this.revealed());

	readonly isImage = computed(() => this.attachment().contentType.startsWith('image/'));

	readonly icon = computed(() => {
		const type = this.attachment().contentType;
		if (type.startsWith('video/')) return 'movie';
		if (type.startsWith('audio/')) return 'volume_up';
		if (type === 'application/pdf') return 'picture_as_pdf';
		return 'description';
	});

	readonly sizeLabel = computed(() => {
		const bytes = this.attachment().size;
		if (bytes < 1024) return `${bytes} o`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
		return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
	});

	reveal(): void {
		this.revealed.set(true);
	}

	hide(): void {
		this.revealed.set(false);
	}

	constructor() {
		effect((onCleanup) => {
			const kind = this.kind();
			const targetId = this.targetId();
			const attachment = this.attachment();

			this.objectUrl.set(null);
			this.failed.set(false);
			// Le composant est reutilise d'une ligne a l'autre par le rendu
			// Angular : sans cette remise a zero, une piece sensible heriterait
			// du voile deja leve sur la precedente.
			this.revealed.set(false);

			let createdUrl: string | null = null;

			const subscription = this.moderationApi
				.downloadAttachment(kind, targetId, attachment.id)
				.subscribe({
					next: (blob) => {
						createdUrl = URL.createObjectURL(blob);
						this.objectUrl.set(createdUrl);
					},
					error: () => this.failed.set(true),
				});

			// Sans cette liberation, chaque passage sur une fiche laisserait le
			// blob en memoire jusqu'au rechargement de l'onglet.
			onCleanup(() => {
				subscription.unsubscribe();
				if (createdUrl) URL.revokeObjectURL(createdUrl);
			});
		});
	}
}
