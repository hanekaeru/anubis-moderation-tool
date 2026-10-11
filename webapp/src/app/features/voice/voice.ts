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
	DEFAULT_VOICE_TEAM_SLOTS,
	MAX_VOICE_PROTECTED_ROLES,
	MAX_VOICE_TEAM_SLOTS,
	Permission,
	VOICE_TEAM_ROLE_LABELS,
	VOICE_PLACEMENT_MODE_DESCRIPTIONS,
	VOICE_PLACEMENT_MODE_LABELS,
	VoicePlacementMode,
	renderVoiceStatus,
	voiceTeamSlots,
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
import {
	formatSnowflakeList,
	listeDeSnowflakes,
	parseSnowflakeList,
} from '../../shared/validators/snowflake-list';

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
	readonly roleLabels = VOICE_TEAM_ROLE_LABELS;
	readonly maxTeamSlots = MAX_VOICE_TEAM_SLOTS;

	/**
	 * Les jetons du gabarit, montres plutot que decrits.
	 *
	 * Une phrase qui enumere « {rang}, {rang-icone}, {plateforme}… » ne dit pas
	 * ce que chacun produit, et c'est precisement la question qu'on se pose en
	 * remplissant le champ.
	 */
	readonly jetons = [
		{ cle: '{rang}', rend: 'Icône et nom du rang', exemple: '🥇 Or' },
		{ cle: '{rang-icone}', rend: 'Icône du rang seule', exemple: '🥇' },
		{ cle: '{plateforme}', rend: 'Icône et nom de la plateforme', exemple: '🖥️ PC' },
		{ cle: '{plateforme-icone}', rend: 'Icône de la plateforme seule', exemple: '🖥️' },
		{ cle: '{roles}', rend: "Composition d'équipe", exemple: '🛡️ 1/2 · ⚔️ 2/2 · 💉 0/2' },
	];

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
		tankSlots: [
			DEFAULT_VOICE_TEAM_SLOTS.tank,
			[Validators.required, Validators.min(0), Validators.max(MAX_VOICE_TEAM_SLOTS)],
		],
		dpsSlots: [
			DEFAULT_VOICE_TEAM_SLOTS.dps,
			[Validators.required, Validators.min(0), Validators.max(MAX_VOICE_TEAM_SLOTS)],
		],
		supportSlots: [
			DEFAULT_VOICE_TEAM_SLOTS.support,
			[Validators.required, Validators.min(0), Validators.max(MAX_VOICE_TEAM_SLOTS)],
		],
		tankEmoji: [''],
		dpsEmoji: [''],
		supportEmoji: [''],
		position: [0, [Validators.required, Validators.min(0)]],
		enabled: [true],
	});

	readonly savingConfig = signal(false);

	/**
	 * Roles proteges, saisis en identifiants separes par des virgules.
	 *
	 * Meme simplification que les pages Sécurité et Expérience : le dashboard
	 * n'a pas de liste des roles du serveur, et en inventer une pour un champ
	 * serait une API de plus a tenir.
	 */
	readonly configForm = this.formBuilder.nonNullable.group({
		protectedRoleIds: ['', [listeDeSnowflakes(MAX_VOICE_PROTECTED_ROLES, 'rôle')]],
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
		this.formValue();
		const raw = this.form.getRawValue();

		return renderVoiceStatus(raw.statusPattern || DEFAULT_VOICE_STATUS_PATTERN, {
			// Les valeurs de repli portent un emoji : sans lui, les jetons réduits
			// à l'icône retomberaient sur le libellé et l'aperçu ne montrerait pas
			// ce que le gabarit produit réellement.
			rank: hub?.ranks[0] ?? { label: 'Or', emoji: '🥇' },
			platform: hub?.platforms[0] ?? { label: 'PC', emoji: '🖥️' },
			// Une equipe a moitie remplie : c'est le cas le plus long a afficher,
			// et celui qui montre a quoi sert le « sur combien ».
			team: voiceTeamSlots(
				{
					tankSlots: raw.tankSlots,
					dpsSlots: raw.dpsSlots,
					supportSlots: raw.supportSlots,
					tankEmoji: raw.tankEmoji.trim() || null,
					dpsEmoji: raw.dpsEmoji.trim() || null,
					supportEmoji: raw.supportEmoji.trim() || null,
				},
				{ tankTaken: 1, dpsTaken: raw.dpsSlots, supportTaken: 0 },
			),
		});
	});

	saveConfig(): void {
		if (this.configForm.invalid) {
			this.configForm.markAllAsTouched();
			return;
		}

		this.savingConfig.set(true);
		this.voiceApi
			.updateConfig({
				protectedRoleIds: parseSnowflakeList(this.configForm.getRawValue().protectedRoleIds),
			})
			.subscribe({
				next: (config) => {
					this.savingConfig.set(false);
					// Réafficher ce que le serveur a retenu : il déduplique, et montrer
					// la saisie laisserait croire qu'un doublon a été conservé.
					this.configForm.setValue({
						protectedRoleIds: formatSnowflakeList(config.protectedRoleIds),
					});
					this.notifications.success('Rôles protégés enregistrés.');
				},
				error: () => this.savingConfig.set(false),
			});
	}

	constructor() {
		this.loadHubs();

		this.voiceApi.getConfig().subscribe({
			next: (config) =>
				this.configForm.setValue({
					protectedRoleIds: formatSnowflakeList(config.protectedRoleIds),
				}),
		});

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
			tankSlots: hub.tankSlots,
			dpsSlots: hub.dpsSlots,
			supportSlots: hub.supportSlots,
			tankEmoji: hub.tankEmoji ?? '',
			dpsEmoji: hub.dpsEmoji ?? '',
			supportEmoji: hub.supportEmoji ?? '',
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
			tankSlots: DEFAULT_VOICE_TEAM_SLOTS.tank,
			dpsSlots: DEFAULT_VOICE_TEAM_SLOTS.dps,
			supportSlots: DEFAULT_VOICE_TEAM_SLOTS.support,
			tankEmoji: '',
			dpsEmoji: '',
			supportEmoji: '',
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

		// Un champ emoji vide vaut « celui de repli », et cela s'ecrit `null` :
		// une chaine vide en base se lirait comme un emoji pose.
		const payload = {
			...raw,
			tankEmoji: raw.tankEmoji.trim() || null,
			dpsEmoji: raw.dpsEmoji.trim() || null,
			supportEmoji: raw.supportEmoji.trim() || null,
		};

		const request$ = id
			? this.voiceApi.updateHub(id, payload)
			: this.voiceApi.createHub(payload);

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
