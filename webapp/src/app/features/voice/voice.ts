import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
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
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { interval, startWith, switchMap } from 'rxjs';
import {
	DEFAULT_VOICE_LANDING_CATEGORY,
	DEFAULT_VOICE_NAME_PATTERN,
	DEFAULT_VOICE_STATUS_PATTERN,
	MAX_VOICE_TOPIC_LENGTH,
	Permission,
	VOICE_PLACEMENT_MODE_DESCRIPTIONS,
	VOICE_PLACEMENT_MODE_LABELS,
	VoicePlacementMode,
	renderVoiceStatus,
	type LiveVoiceDto,
	type VoiceHubDto,
	type VoiceHubPlatformDto,
	type VoiceHubRankDto,
} from '@anubis/shared';
import { VoiceApi } from '../../core/api/voice.api';
import { NotificationService } from '../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../shared/components/confirm-dialog';
import { StatCard } from '../../shared/components/stat-card';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { FrDatePipe, RelativeTimePipe } from '../../shared/pipes/format.pipes';

/** Vue d'exploitation : elle doit vieillir vite, sans pour autant marteler l'API. */
const LIVE_POLL_INTERVAL_MS = 10_000;

/** Meme forme que cote API : l'identifiant de categorie est saisi a la main. */
const SNOWFLAKE = /^\d{17,20}$/;

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
		MatSelectModule,
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
	readonly placementModes = Object.values(VoicePlacementMode);
	// Indexés depuis le template, où les lignes de mat-table arrivent typées
	// `any` : un `Record<VoicePlacementMode, string>` ne s'y indexe pas.
	readonly placementLabels: Record<string, string> = VOICE_PLACEMENT_MODE_LABELS;
	readonly placementDescriptions: Record<string, string> =
		VOICE_PLACEMENT_MODE_DESCRIPTIONS;
	readonly hubColumns = ['name', 'pattern', 'options', 'userLimit', 'state', 'actions'];
	readonly maxTopicLength = MAX_VOICE_TOPIC_LENGTH;

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
		statusPattern: [DEFAULT_VOICE_STATUS_PATTERN, [Validators.required]],
		placementMode: [VoicePlacementMode.RANK_CATEGORY as VoicePlacementMode],
		landingCategoryName: [
			DEFAULT_VOICE_LANDING_CATEGORY,
			[Validators.required, Validators.maxLength(100)],
		],
		userLimit: [0, [Validators.required, Validators.min(0), Validators.max(99)]],
		position: [0, [Validators.required, Validators.min(0)]],
		enabled: [true],
	});

	/** Ajout d'un rang : la categorie se saisit en identifiant, comme ailleurs. */
	readonly rankForm = this.formBuilder.nonNullable.group({
		label: ['', [Validators.required, Validators.maxLength(40)]],
		emoji: [''],
		categoryId: ['', [Validators.pattern(SNOWFLAKE)]],
	});

	readonly platformForm = this.formBuilder.nonNullable.group({
		label: ['', [Validators.required, Validators.maxLength(40)]],
		emoji: [''],
	});

	/** Le salon de creation en cours d'edition, seul a pouvoir porter des rangs. */
	readonly editingHub = computed(
		() => this.hubs().find((hub) => hub.id === this.editingId()) ?? null,
	);

	/**
	 * Le formulaire vit hors du graphe de signaux : sans cette passerelle,
	 * l'apercu du sujet resterait fige en `OnPush`.
	 */
	private readonly formValue = toSignal(this.form.valueChanges, {
		initialValue: this.form.getRawValue(),
	});

	/**
	 * Apercu du sujet, rendu par la meme fonction que le bot.
	 *
	 * Les valeurs d'exemple viennent du hub edite quand il en a : un apercu
	 * bati sur des libelles inventes ne dirait rien de la longueur reelle une
	 * fois « Grandmaster » et un emoji personnalise en place.
	 */
	readonly apercuSujet = computed(() => {
		const hub = this.editingHub();
		const gabarit = this.formValue().statusPattern ?? DEFAULT_VOICE_STATUS_PATTERN;

		return renderVoiceStatus(gabarit, {
			rank: hub?.ranks[0] ?? { label: 'Or' },
			platform: hub?.platforms[0] ?? { label: 'PC' },
			topic: 'cherche 2 joueurs',
		});
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
			statusPattern: hub.statusPattern,
			placementMode: hub.placementMode,
			landingCategoryName: hub.landingCategoryName,
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
			statusPattern: DEFAULT_VOICE_STATUS_PATTERN,
			placementMode: VoicePlacementMode.RANK_CATEGORY,
			landingCategoryName: DEFAULT_VOICE_LANDING_CATEGORY,
			userLimit: 0,
			position: 0,
			enabled: true,
		});
		this.rankForm.reset({ label: '', emoji: '', categoryId: '' });
		this.platformForm.reset({ label: '', emoji: '' });
	}

	addRank(): void {
		const hub = this.editingHub();
		if (!hub || this.rankForm.invalid) {
			this.rankForm.markAllAsTouched();
			return;
		}

		const raw = this.rankForm.getRawValue();

		this.voiceApi
			.createRank(hub.id, {
				label: raw.label,
				emoji: raw.emoji.trim() || null,
				// Vide : le bot creera la categorie d'apres le libelle du rang,
				// au premier salon qui le choisit.
				categoryId: raw.categoryId.trim() || null,
			})
			.subscribe({
				next: () => {
					this.rankForm.reset({ label: '', emoji: '', categoryId: '' });
					this.loadHubs();
				},
			});
	}

	/**
	 * Retire un rang de la liste.
	 *
	 * Les salons qui le portaient ne sont pas deplaces : ils restent dans la
	 * categorie ou ils sont jusqu'a ce que leur proprietaire en choisisse un
	 * autre. Le dire ici evite qu'on cherche le bug cote bot.
	 */
	removeRank(rank: VoiceHubRankDto): void {
		const hub = this.editingHub();
		if (!hub) return;

		this.voiceApi.deleteRank(hub.id, rank.id).subscribe({
			next: () => {
				this.notifications.success(
					`Rang « ${rank.label} » retiré. Les salons déjà rangés dans sa catégorie n'en bougent pas.`,
				);
				this.loadHubs();
			},
		});
	}

	addPlatform(): void {
		const hub = this.editingHub();
		if (!hub || this.platformForm.invalid) {
			this.platformForm.markAllAsTouched();
			return;
		}

		const raw = this.platformForm.getRawValue();

		this.voiceApi
			.createPlatform(hub.id, {
				label: raw.label,
				emoji: raw.emoji.trim() || null,
			})
			.subscribe({
				next: () => {
					this.platformForm.reset({ label: '', emoji: '' });
					this.loadHubs();
				},
			});
	}

	removePlatform(platform: VoiceHubPlatformDto): void {
		const hub = this.editingHub();
		if (!hub) return;

		this.voiceApi.deletePlatform(hub.id, platform.id).subscribe({
			next: () => this.loadHubs(),
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
