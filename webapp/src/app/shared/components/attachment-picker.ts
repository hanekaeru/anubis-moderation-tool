import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
	MAX_MODERATION_ATTACHMENTS,
	MAX_MODERATION_ATTACHMENT_BYTES,
	MODERATION_ATTACHMENT_CONTENT_TYPES,
} from '@anubis/shared';

/** Un fichier retenu, avec le marqueur decide au moment du depot. */
export interface PickedAttachment {
	file: File;
	spoiler: boolean;
}

/**
 * Choix des fichiers a joindre a un avertissement ou a une sanction.
 *
 * Les fichiers sont retenus ici et envoyes seulement apres la creation de la
 * decision, qui seule fournit l'identifiant auquel les rattacher. Les regles
 * de taille et de nombre sont verifiees ici pour l'eviter a l'utilisateur,
 * mais c'est l'API qui fait foi.
 *
 * Deux boutons de depot plutot qu'une case a cocher unique, comme les deux
 * zones de la modale `/preuve` du bot : un meme envoi melange couramment une
 * capture anodine et une image penible, et un reglage commun forcerait a
 * marquer les deux ou aucune. Le marqueur reste rectifiable ligne par ligne.
 *
 * La liste est suivie par identite du `File`, pas par nom et taille : les deux
 * zones rendent le meme fichier choisissable deux fois, et une cle dupliquee
 * fait echouer le rendu Angular.
 */
@Component({
	selector: 'app-attachment-picker',
	imports: [MatButtonModule, MatIconModule, MatTooltipModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="picker">
			<input
				#input
				type="file"
				multiple
				hidden
				[accept]="accept"
				(change)="onPick(input, false)"
			/>
			<input
				#sensitiveInput
				type="file"
				multiple
				hidden
				[accept]="accept"
				(change)="onPick(sensitiveInput, true)"
			/>

			<button matButton type="button" [disabled]="full()" (click)="input.click()">
				<mat-icon>attach_file</mat-icon>
				Joindre un fichier
			</button>

			<button
				matButton
				type="button"
				[disabled]="full()"
				matTooltip="Masquée sur la fiche tant que le staff ne l'affiche pas"
				(click)="sensitiveInput.click()"
			>
				<mat-icon>visibility_off</mat-icon>
				Joindre une preuve sensible
			</button>

			<span class="hint">
				{{ files().length }}/{{ maxCount }} · {{ maxSizeLabel }} par fichier
			</span>
		</div>

		@if (rejected(); as message) {
			<p class="rejected" role="alert">{{ message }}</p>
		}

		@if (files().length) {
			<ul class="list">
				@for (picked of files(); track picked.file) {
					<li>
						<mat-icon>{{ picked.file.type.startsWith('image/') ? 'image' : 'description' }}</mat-icon>
						<span class="name">{{ picked.file.name }}</span>
						<span class="size">{{ sizeLabel(picked.file.size) }}</span>
						<button
							matIconButton
							type="button"
							[matTooltip]="
								picked.spoiler ? 'Marquée sensible — cliquer pour démarquer' : 'Marquer comme sensible'
							"
							[class.marked]="picked.spoiler"
							(click)="toggleSpoilerAt($index)"
						>
							<mat-icon>{{ picked.spoiler ? 'visibility_off' : 'visibility' }}</mat-icon>
						</button>
						<button
							matIconButton
							type="button"
							matTooltip="Retirer"
							(click)="removeAt($index)"
						>
							<mat-icon>close</mat-icon>
						</button>
					</li>
				}
			</ul>
		}
	`,
	styles: `
		.picker {
			display: flex;
			align-items: center;
			gap: 10px;
			flex-wrap: wrap;
		}

		.hint {
			color: var(--mat-sys-on-surface-variant);
			font-size: 0.78rem;
		}

		.rejected {
			margin: 6px 0 0;
			color: var(--mat-sys-error);
			font-size: 0.8rem;
		}

		.list {
			list-style: none;
			margin: 8px 0 0;
			padding: 0;
			display: flex;
			flex-direction: column;
			gap: 4px;

			li {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 2px 4px 2px 10px;
				border-radius: 8px;
				background: var(--mat-sys-surface-variant);
				font-size: 0.82rem;
			}

			mat-icon {
				font-size: 18px;
				width: 18px;
				height: 18px;
			}
		}

		.name {
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.size {
			color: var(--mat-sys-on-surface-variant);
			font-size: 0.75rem;
		}

		.marked {
			color: var(--mat-sys-primary);
		}
	`,
})
export class AttachmentPicker {
	/** Liste blanche partagee avec l'API, qui reste seule a faire foi. */
	readonly accept = MODERATION_ATTACHMENT_CONTENT_TYPES.join(',');

	readonly maxCount = MAX_MODERATION_ATTACHMENTS;
	readonly maxSizeLabel = `${Math.floor(MAX_MODERATION_ATTACHMENT_BYTES / 1024 / 1024)} Mo`;

	readonly files = model<PickedAttachment[]>([]);
	readonly disabled = input(false);

	readonly rejected = model<string | null>(null);

	readonly full = computed(() => this.disabled() || this.files().length >= this.maxCount);

	onPick(input: HTMLInputElement, spoiler: boolean): void {
		const picked = Array.from(input.files ?? []);
		// Le meme `<input>` sert a chaque clic : sans cette remise a zero,
		// rechoisir le meme fichier ne declencherait plus d'evenement.
		input.value = '';
		if (!picked.length) return;

		const tropGros = picked.filter((file) => file.size > MAX_MODERATION_ATTACHMENT_BYTES);
		const restants = picked.filter((file) => file.size <= MAX_MODERATION_ATTACHMENT_BYTES);
		const place = this.maxCount - this.files().length;
		const retenus = restants.slice(0, place);

		const refus: string[] = [];
		if (tropGros.length) {
			refus.push(`${tropGros.length} fichier(s) au-dela de ${this.maxSizeLabel}`);
		}
		if (restants.length > place) {
			refus.push(`${restants.length - place} fichier(s) au-dela de ${this.maxCount}`);
		}

		this.rejected.set(refus.length ? `Ignoré : ${refus.join(', ')}.` : null);
		if (retenus.length) {
			this.files.update((current) => [
				...current,
				...retenus.map((file) => ({ file, spoiler })),
			]);
		}
	}

	toggleSpoilerAt(index: number): void {
		this.files.update((current) =>
			current.map((picked, i) =>
				i === index ? { ...picked, spoiler: !picked.spoiler } : picked,
			),
		);
	}

	removeAt(index: number): void {
		this.files.update((current) => current.filter((_, i) => i !== index));
		this.rejected.set(null);
	}

	sizeLabel(bytes: number): string {
		if (bytes < 1024) return `${bytes} o`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
		return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
	}
}
