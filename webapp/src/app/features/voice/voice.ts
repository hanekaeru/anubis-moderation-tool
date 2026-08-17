import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { interval, startWith, switchMap } from 'rxjs';
import {
	DEFAULT_VOICE_NAME_PATTERN,
	Permission,
	type LiveVoiceDto,
	type VoiceHubDto,
} from '@anubis/shared';
import { VoiceApi } from '../../core/api/voice.api';
import { NotificationService } from '../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../shared/components/confirm-dialog';
import { StatCard } from '../../shared/components/stat-card';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { FrDatePipe, RelativeTimePipe } from '../../shared/pipes/format.pipes';

/** Vue d'exploitation : elle doit vieillir vite, sans pour autant marteler l'API. */
const LIVE_POLL_INTERVAL_MS = 10_000;

@Component({
	selector: 'app-voice',
	imports: [
		FrDatePipe,
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatProgressBarModule,
		MatSlideToggleModule,
		MatTableModule,
		MatTooltipModule,
		ReactiveFormsModule,
		RelativeTimePipe,
		StatCard,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './voice.html',
	styleUrl: './voice.scss',
})
export class VoicePage {
	private readonly voiceApi = inject(VoiceApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);
	private readonly dialog = inject(MatDialog);

	readonly Permission = Permission;
	readonly hubColumns = ['name', 'pattern', 'userLimit', 'state', 'actions'];

	readonly loading = signal(true);
	readonly saving = signal(false);
	readonly hubs = signal<VoiceHubDto[]>([]);
	readonly live = signal<LiveVoiceDto | null>(null);
	readonly editingId = signal<string | null>(null);

	readonly channels = computed(() => this.live()?.channels ?? []);

	/** Un salon de creation actif mais jamais materialise ne captera personne. */
	readonly hubsSansSalon = computed(
		() => this.hubs().filter((hub) => hub.enabled && !hub.channelId).length,
	);

	readonly form = this.formBuilder.nonNullable.group({
		name: ['', [Validators.required, Validators.maxLength(100)]],
		namePattern: [
			DEFAULT_VOICE_NAME_PATTERN,
			[Validators.required, Validators.pattern(/\{index\}/)],
		],
		userLimit: [0, [Validators.required, Validators.min(0), Validators.max(99)]],
		position: [0, [Validators.required, Validators.min(0)]],
		enabled: [true],
	});

	constructor() {
		this.loadHubs();

		interval(LIVE_POLL_INTERVAL_MS)
			.pipe(
				startWith(0),
				switchMap(() => this.voiceApi.live()),
				takeUntilDestroyed(),
			)
			.subscribe({
				next: (live) => {
					this.live.set(live);
					this.loading.set(false);
				},
				error: () => this.loading.set(false),
			});
	}

	edit(hub: VoiceHubDto): void {
		this.editingId.set(hub.id);
		this.form.setValue({
			name: hub.name,
			namePattern: hub.namePattern,
			userLimit: hub.userLimit,
			position: hub.position,
			enabled: hub.enabled,
		});
	}

	cancelEdit(): void {
		this.editingId.set(null);
		this.form.reset({
			name: '',
			namePattern: DEFAULT_VOICE_NAME_PATTERN,
			userLimit: 0,
			position: 0,
			enabled: true,
		});
	}

	save(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}

		this.saving.set(true);
		const raw = this.form.getRawValue();
		const id = this.editingId();

		const request$ = id
			? this.voiceApi.updateHub(id, raw)
			: this.voiceApi.createHub(raw);

		request$.subscribe({
			next: () => {
				this.saving.set(false);
				this.notifications.success(
					id
						? 'Salon de création mis à jour.'
						: 'Salon de création ajouté — lance /create_parties sur Discord.',
				);
				this.cancelEdit();
				this.loadHubs();
			},
			error: () => this.saving.set(false),
		});
	}

	toggleEnabled(hub: VoiceHubDto): void {
		this.voiceApi.updateHub(hub.id, { enabled: !hub.enabled }).subscribe({
			next: () => this.loadHubs(),
		});
	}

	remove(hub: VoiceHubDto): void {
		// L'API refuse la suppression tant que des salons en dépendent : le dire
		// ici évite un aller-retour qui ne pouvait qu'échouer.
		if (hub.activeChannels) {
			this.notifications.error(
				`${hub.activeChannels} salon(s) issu(s) de « ${hub.name} » sont encore ouverts. ` +
					'Désactive-le et attends qu’ils se vident, ou lance /purge_vocaux sur Discord.',
			);
			return;
		}

		const data: ConfirmDialogData = {
			title: 'Supprimer le salon de création',
			message: hub.channelId
				? `« ${hub.name} » disparaît de la liste, mais son salon Discord reste en place : utilise /delete_parties pour l'effacer aussi.`
				: `« ${hub.name} » sera retiré de la liste.`,
			confirmLabel: 'Supprimer',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.voiceApi.deleteHub(hub.id).subscribe({
					next: () => {
						this.notifications.success('Salon de création supprimé.');
						if (this.editingId() === hub.id) this.cancelEdit();
						this.loadHubs();
					},
				});
			});
	}

	private loadHubs(): void {
		this.voiceApi.listHubs().subscribe({ next: (hubs) => this.hubs.set(hubs) });
	}
}
