import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
	defaultXpLevelUpMessage,
	MAX_XP_LEVEL_UP_MESSAGE_LENGTH,
	MAX_XP_REWARD_LEVEL,
	Permission,
	renderXpLevelUpMessage,
	XP_ANNOUNCEMENT_MODE_DESCRIPTIONS,
	XP_ANNOUNCEMENT_MODE_LABELS,
	XP_LEVEL_UP_PLACEHOLDERS,
	XpAnnouncementMode,
	xpRequiredForLevel,
	type XpConfigDto,
	type XpLeaderboardRowDto,
	type XpOverviewDto,
	type XpRewardRoleDto,
} from '@anubis/shared';
import { XpApi } from '../../core/api/xp.api';
import { NotificationService } from '../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../shared/components/confirm-dialog';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Experience des membres et paliers de recompense.
 *
 * L'XP est alimentee par le bot seul : cette page la lit. Les paliers, eux, se
 * reglent ici et sont appliques par le bot — a chaque montee de niveau, et par
 * un rattrapage periodique qui distribue un palier nouvellement ajoute aux
 * membres qui le meritent deja.
 *
 * Les identifiants de role se saisissent en texte libre, comme sur les pages de
 * securite : aucune liste de roles simple n'est encore exposee par l'API.
 */
@Component({
	selector: 'app-xp',
	imports: [
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatCheckboxModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatPaginatorModule,
		MatProgressBarModule,
		MatSelectModule,
		MatSlideToggleModule,
		MatTooltipModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './xp.html',
	styleUrl: './xp.scss',
})
export class XpPage {
	private readonly xpApi = inject(XpApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);
	private readonly dialog = inject(MatDialog);

	readonly Permission = Permission;
	readonly maxLevel = MAX_XP_REWARD_LEVEL;
	readonly maxMessageLength = MAX_XP_LEVEL_UP_MESSAGE_LENGTH;
	readonly placeholders = XP_LEVEL_UP_PLACEHOLDERS;
	readonly modeLabels = XP_ANNOUNCEMENT_MODE_LABELS;
	readonly modeDescriptions = XP_ANNOUNCEMENT_MODE_DESCRIPTIONS;
	readonly modes = Object.values(XpAnnouncementMode);

	readonly loading = signal(true);
	readonly saving = signal(false);
	readonly overview = signal<XpOverviewDto | null>(null);
	readonly rows = signal<XpLeaderboardRowDto[]>([]);
	readonly total = signal(0);
	readonly pageIndex = signal(0);
	readonly pageSize = signal(25);
	readonly search = signal('');
	readonly editingRewardId = signal<string | null>(null);
	readonly savingConfig = signal(false);

	readonly rewards = computed(() => this.overview()?.rewards ?? []);

	readonly rewardForm = this.formBuilder.nonNullable.group({
		roleId: ['', [Validators.required, Validators.pattern(SNOWFLAKE)]],
		level: [
			5,
			[Validators.required, Validators.min(1), Validators.max(MAX_XP_REWARD_LEVEL)],
		],
		replacePrevious: [false],
	});

	readonly searchForm = this.formBuilder.nonNullable.group({ term: [''] });

	/**
	 * Annonce des montees de niveau.
	 *
	 * `message` reste vide tant que le serveur garde le texte par defaut : un
	 * champ pre-rempli avec ce defaut le figerait a la premiere sauvegarde, et
	 * changer de mode ne changerait plus le texte.
	 */
	readonly configForm = this.formBuilder.nonNullable.group({
		mode: [XpAnnouncementMode.CURRENT_CHANNEL as XpAnnouncementMode],
		channelId: [''],
		message: ['', [Validators.maxLength(MAX_XP_LEVEL_UP_MESSAGE_LENGTH)]],
		pingMember: [true],
	});

	/**
	 * Etat du formulaire en signal.
	 *
	 * `valueChanges` vit hors du graphe de signaux : sans cette passerelle,
	 * l'apercu ne se redessinerait jamais en `OnPush`. Meme montage que la page
	 * Messages.
	 */
	private readonly configValue = toSignal(this.configForm.valueChanges, {
		initialValue: this.configForm.getRawValue(),
	});

	/**
	 * Apercu du message, rendu par la fonction que le bot utilise lui-meme.
	 *
	 * La mention est remplacee par un pseudo lisible : `<@123…>` ne veut rien
	 * dire hors de Discord, et un apercu illisible ne previent de rien.
	 */
	readonly configPreview = computed(() => {
		this.configValue();
		const raw = this.configForm.getRawValue();

		return renderXpLevelUpMessage(raw.message.trim() || defaultXpLevelUpMessage(raw.mode), {
			member: raw.pingMember ? '@Membre' : 'Membre',
			level: 10,
			guildName: 'Nom du serveur',
			roleMentions: ['@Habitué'],
		});
	});

	/** Le salon n'est demande — et exigé — que par le mode « salon dédié ». */
	readonly needsChannel = computed(() => {
		this.configValue();
		return this.configForm.getRawValue().mode === XpAnnouncementMode.DEDICATED_CHANNEL;
	});

	constructor() {
		this.loadOverview();
		this.loadPage();
	}

	saveConfig(): void {
		const raw = this.configForm.getRawValue();

		if (this.configForm.invalid) {
			this.configForm.markAllAsTouched();
			return;
		}

		// L'API refuse le mode sans salon ; le dire ici evite un aller-retour
		// pour une erreur que le formulaire connait deja.
		if (raw.mode === XpAnnouncementMode.DEDICATED_CHANNEL && !SNOWFLAKE.test(raw.channelId)) {
			this.configForm.controls.channelId.setErrors({ pattern: true });
			this.configForm.controls.channelId.markAsTouched();
			return;
		}

		this.savingConfig.set(true);

		this.xpApi
			.updateConfig({
				mode: raw.mode,
				channelId: SNOWFLAKE.test(raw.channelId) ? raw.channelId : null,
				// Vider le champ, c'est revenir au texte par defaut du mode.
				message: raw.message.trim() || null,
				pingMember: raw.pingMember,
			})
			.subscribe({
				next: (config) => {
					this.savingConfig.set(false);
					this.applyConfig(config);
					this.notifications.success('Annonce des montées de niveau mise à jour.');
				},
				error: () => this.savingConfig.set(false),
			});
	}

	private applyConfig(config: XpConfigDto): void {
		this.configForm.setValue({
			mode: config.mode,
			channelId: config.channelId ?? '',
			message: config.message ?? '',
			pingMember: config.pingMember,
		});
	}

	/** XP totale exigee par un palier : la meme formule que le bot, partagée. */
	xpForLevel(level: number): number {
		return xpRequiredForLevel(level);
	}

	/** Nom du role si le référentiel le connaît, identifiant brut sinon. */
	roleLabel(reward: XpRewardRoleDto): string {
		return reward.roleName ?? reward.roleId;
	}

	/** Couleur Discord (`0` = « pas de couleur ») rendue en CSS. */
	roleColor(reward: XpRewardRoleDto): string | null {
		if (!reward.roleColor) return null;
		return `#${reward.roleColor.toString(16).padStart(6, '0')}`;
	}

	applySearch(): void {
		this.search.set(this.searchForm.getRawValue().term.trim());
		this.pageIndex.set(0);
		this.loadPage();
	}

	onPage(event: PageEvent): void {
		this.pageIndex.set(event.pageIndex);
		this.pageSize.set(event.pageSize);
		this.loadPage();
	}

	editReward(reward: XpRewardRoleDto): void {
		this.editingRewardId.set(reward.id);
		this.rewardForm.setValue({
			roleId: reward.roleId,
			level: reward.level,
			replacePrevious: reward.replacePrevious,
		});
	}

	cancelRewardEdit(): void {
		this.editingRewardId.set(null);
		this.rewardForm.reset({ roleId: '', level: 5, replacePrevious: false });
	}

	saveReward(): void {
		if (this.rewardForm.invalid) {
			this.rewardForm.markAllAsTouched();
			return;
		}

		this.saving.set(true);
		const raw = this.rewardForm.getRawValue();
		const id = this.editingRewardId();

		const request$ = id
			? this.xpApi.updateReward(id, raw)
			: this.xpApi.createReward(raw);

		request$.subscribe({
			next: () => {
				this.saving.set(false);
				this.notifications.success(
					id
						? 'Palier mis à jour.'
						: 'Palier enregistré — le bot le distribuera au prochain passage.',
				);
				this.cancelRewardEdit();
				this.loadOverview();
				this.loadPage();
			},
			error: () => this.saving.set(false),
		});
	}

	removeReward(reward: XpRewardRoleDto): void {
		const data: ConfirmDialogData = {
			title: 'Supprimer le palier',
			message: `Le rôle ${this.roleLabel(reward)} cessera d'être attribué au niveau ${reward.level}. Les ${reward.eligibleMemberCount} membre(s) qui le portent déjà le conservent.`,
			confirmLabel: 'Supprimer',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.xpApi.removeReward(reward.id).subscribe({
					next: () => {
						this.notifications.success('Palier supprimé.');
						if (this.editingRewardId() === reward.id) this.cancelRewardEdit();
						this.loadOverview();
						this.loadPage();
					},
				});
			});
	}

	private loadOverview(): void {
		this.xpApi.overview().subscribe({
			next: (overview) => {
				this.overview.set(overview);
				// Le formulaire n'est reinitialise que par le chargement et par une
				// sauvegarde : le rafraichir a chaque relecture ecraserait une
				// saisie en cours.
				if (!this.savingConfig()) this.applyConfig(overview.config);
			},
		});
	}

	private loadPage(): void {
		this.loading.set(true);

		this.xpApi
			.leaderboard({
				page: this.pageIndex() + 1,
				pageSize: this.pageSize(),
				search: this.search() || undefined,
			})
			.subscribe({
				next: (page) => {
					this.rows.set(page.items);
					this.total.set(page.total);
					this.loading.set(false);
				},
				error: () => this.loading.set(false),
			});
	}
}
