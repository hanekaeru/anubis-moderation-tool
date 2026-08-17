import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { TicketAttachmentRef } from '@anubis/shared';
import { TicketsApi } from '../../core/api/tickets.api';

/**
 * Piece jointe d'un ticket : image affichee inline, autre fichier en lien de
 * telechargement. Les pieces jointes sont protegees par JWT (voir
 * `TicketsApi.downloadAttachment`), donc chargees en blob puis exposees via
 * une URL objet plutot qu'un simple `<img src>`, qui ne porterait pas
 * l'en-tete d'autorisation.
 */
@Component({
	selector: 'app-ticket-attachment',
	imports: [MatIconModule, MatProgressSpinnerModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (objectUrl(); as url) {
			@if (isImage()) {
				<a [href]="url" target="_blank" rel="noopener" class="preview">
					<img [src]="url" [alt]="attachment().fileName" />
				</a>
			} @else {
				<a [href]="url" [download]="attachment().fileName" class="file-chip">
					<mat-icon>description</mat-icon>
					<span>{{ attachment().fileName }}</span>
				</a>
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
	`,
	styles: `
		.preview img {
			display: block;
			max-width: 280px;
			max-height: 220px;
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

		.file-chip.error {
			color: var(--mat-sys-error);
		}
	`,
})
export class TicketAttachment {
	private readonly ticketsApi = inject(TicketsApi);

	readonly ticketId = input.required<string>();
	readonly attachment = input.required<TicketAttachmentRef>();

	readonly objectUrl = signal<string | null>(null);
	readonly failed = signal(false);
	readonly isImage = computed(() => this.attachment().contentType.startsWith('image/'));

	constructor() {
		effect((onCleanup) => {
			const ticketId = this.ticketId();
			const attachment = this.attachment();
			this.objectUrl.set(null);
			this.failed.set(false);

			let createdUrl: string | null = null;

			const subscription = this.ticketsApi
				.downloadAttachment(ticketId, attachment.id)
				.subscribe({
					next: (blob) => {
						createdUrl = URL.createObjectURL(blob);
						this.objectUrl.set(createdUrl);
					},
					error: () => this.failed.set(true),
				});

			onCleanup(() => {
				subscription.unsubscribe();
				if (createdUrl) URL.revokeObjectURL(createdUrl);
			});
		});
	}
}
