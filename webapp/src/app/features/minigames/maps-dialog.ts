import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { MinigameMapDto } from '@anubis/shared';
import { MinigamesApi } from '../../core/api/minigames.api';
import { readApiError } from '../../core/error.interceptor';

/**
 * Maps proposees a « Devine la map ».
 *
 * Pas de suppression : une map se **desactive** (ni proposable, ni choisie
 * comme reponse), sa cle vivant dans les jeux et les essais passes. La cle se
 * tire du nom a la creation ; renommer ne change que le libelle affiche.
 */
@Component({
	selector: 'app-minigame-maps-dialog',
	imports: [
		FormsModule,
		MatButtonModule,
		MatDialogModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatSlideToggleModule,
		MatTooltipModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>Maps</h2>

		<mat-dialog-content>
			<form class="add" (ngSubmit)="add()">
				<mat-form-field subscriptSizing="dynamic">
					<mat-label>Nouvelle map</mat-label>
					<input matInput name="name" [(ngModel)]="newName" maxlength="60" />
				</mat-form-field>
				<button matButton="tonal" type="submit" [disabled]="busy() || !newName.trim()">Ajouter</button>
			</form>

			<ul class="maps">
				@for (map of maps(); track map.key) {
					<li [class.disabled]="!map.enabled">
						@if (editing() === map.key) {
							<mat-form-field subscriptSizing="dynamic" class="rename">
								<input
									matInput
									[(ngModel)]="editName"
									maxlength="60"
									(keydown.enter)="rename(map)"
									(keydown.escape)="editing.set(null)"
									aria-label="Nouveau nom"
								/>
							</mat-form-field>
							<button matIconButton matTooltip="Enregistrer" [disabled]="busy()" (click)="rename(map)">
								<mat-icon>check</mat-icon>
							</button>
						} @else {
							<span class="name">{{ map.name }}</span>
							<button matIconButton matTooltip="Renommer" (click)="startEdit(map)">
								<mat-icon>edit</mat-icon>
							</button>
						}
						<mat-slide-toggle
							[checked]="map.enabled"
							[disabled]="busy()"
							(change)="toggle(map, $event.checked)"
							[matTooltip]="map.enabled ? 'Proposée' : 'Désactivée'"
							[attr.aria-label]="'Proposer ' + map.name"
						/>
					</li>
				}
			</ul>

			@if (error(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}
		</mat-dialog-content>

		<mat-dialog-actions align="end">
			<button matButton (click)="close()">Fermer</button>
		</mat-dialog-actions>
	`,
	styles: `
		.add {
			display: flex;
			align-items: center;
			gap: var(--space-3);
			margin: 4px 0 var(--space-4);

			mat-form-field {
				flex: 1;
			}
		}

		.maps {
			list-style: none;
			margin: 0;
			padding: 0;
			min-width: 420px;
		}

		li {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			min-height: 48px;
			border-bottom: 1px solid var(--mat-sys-outline-variant);
		}

		li.disabled .name {
			color: var(--mat-sys-on-surface-variant);
			text-decoration: line-through;
		}

		.name,
		.rename {
			flex: 1;
		}

		.error {
			margin: var(--space-3) 0 0;
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-error-container);
			color: var(--mat-sys-on-error-container);
		}

		@media (max-width: 640px) {
			.maps {
				min-width: 0;
			}
		}
	`,
})
export class MinigameMapsDialog {
	private readonly api = inject(MinigamesApi);
	private readonly dialogRef = inject(MatDialogRef<MinigameMapsDialog, boolean>);

	readonly maps = signal<MinigameMapDto[]>([...inject<MinigameMapDto[]>(MAT_DIALOG_DATA)]);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	readonly editing = signal<string | null>(null);
	newName = '';
	editName = '';
	private changed = false;

	close(): void {
		this.dialogRef.close(this.changed);
	}

	private replace(saved: MinigameMapDto): void {
		this.changed = true;
		this.maps.update((list) =>
			[...list.filter((m) => m.key !== saved.key), saved].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
		);
	}

	private run(call: ReturnType<MinigamesApi['createMap']>, after?: () => void): void {
		this.busy.set(true);
		this.error.set(null);
		call.subscribe({
			next: (saved) => {
				this.busy.set(false);
				this.replace(saved);
				after?.();
			},
			error: (err) => {
				this.busy.set(false);
				this.error.set(readApiError(err));
			},
		});
	}

	add(): void {
		const name = this.newName.trim();
		if (!name) return;
		this.run(this.api.createMap({ name }), () => (this.newName = ''));
	}

	startEdit(map: MinigameMapDto): void {
		this.editName = map.name;
		this.editing.set(map.key);
	}

	rename(map: MinigameMapDto): void {
		const name = this.editName.trim();
		if (!name || name === map.name) {
			this.editing.set(null);
			return;
		}
		this.run(this.api.updateMap(map.key, { name }), () => this.editing.set(null));
	}

	toggle(map: MinigameMapDto, enabled: boolean): void {
		this.run(this.api.updateMap(map.key, { enabled }));
	}
}
