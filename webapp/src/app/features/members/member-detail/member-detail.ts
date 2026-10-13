import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	computed,
	effect,
	inject,
	input,
	signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { forkJoin, map, of, timer } from 'rxjs';
import {
	ACCOUNT_FLAG_TYPE_LABELS,
	MEMBER_STATUS_LABELS,
	MAX_MODERATION_ATTACHMENT_BYTES,
	MODERATION_ATTACHMENT_CONTENT_TYPES,
	MODERATION_RISK_LABELS,
	Permission,
	SANCTION_TYPE_LABELS,
	STATS_PERIOD_LABELS,
	WARNING_SEVERITY_LABELS,
	WEEKDAY_LABELS,
	roleColorToHex,
	type AccountFlagDto,
	type MemberActivityStats,
	type MemberDetail,
	type ModerationScoreDto,
	type NoteDto,
	type RoleSummary,
	type SanctionDto,
	type StatsPeriod,
	type TimelineEntry,
	type VoiceSessionDto,
	type WarningDto,
} from '@anubis/shared';
import { AccountFlagsApi } from '../../../core/api/account-flags.api';
import { MembersApi } from '../../../core/api/members.api';
import { ModerationApi, type ModerationTarget } from '../../../core/api/moderation.api';
import { StatsApi } from '../../../core/api/stats.api';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/notification.service';
import { ChartCard } from '../../../shared/charts/chart-card';
import { ChartPalette } from '../../../shared/charts/chart-palette';
import {
	barOptions,
	heatmapOptions,
	timeSeriesOptions,
} from '../../../shared/charts/chart-options';
import { ConfirmDialog, type ConfirmDialogData } from '../../../shared/components/confirm-dialog';
import { MemberAvatar } from '../../../shared/components/member-avatar';
import { ModerationAttachment } from '../../../shared/components/moderation-attachment';
import { StatCard } from '../../../shared/components/stat-card';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { DurationPipe, FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';
import { SanctionDialog } from '../../moderation/dialogs/sanction-dialog';
import { WarningDialog } from '../../moderation/dialogs/warning-dialog';

/**
 * Icone associee a chaque type d'evenement de la chronologie. Valeurs
 * possiblement absentes : un type ajoute cote API doit degrader proprement.
 */
/** Liste blanche partagee avec l'API, comme dans `AttachmentPicker`. */
const ATTACHMENT_ACCEPT = MODERATION_ATTACHMENT_CONTENT_TYPES.join(',');

/**
 * Delai avant de relire la fiche apres une demande de separateurs : un peu plus
 * que le cycle de synchronisation du bot (5 s), le temps qu'il pose les roles
 * et que l'evenement Discord revienne mettre la base a jour.
 */
const SEPARATOR_RELOAD_DELAY_MS = 7_000;

const TIMELINE_ICONS: Record<string, string | undefined> = {
	WARNING: 'flag',
	SANCTION: 'gavel',
	NOTE: 'sticky_note_2',
	ROLE: 'label',
	IDENTITY: 'badge',
	JOIN: 'login',
	LEAVE: 'logout',
	TICKET: 'confirmation_number',
};

@Component({
	selector: 'app-member-detail',
	imports: [
		ChartCard,
		DurationPipe,
		FrDatePipe,
		HasPermissionDirective,
		MatButtonModule,
		MatButtonToggleModule,
		MatCardModule,
		MatDividerModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatMenuModule,
		MatProgressBarModule,
		MatSlideToggleModule,
		MatTabsModule,
		MatTooltipModule,
		MemberAvatar,
		ModerationAttachment,
		ReactiveFormsModule,
		RelativeTimePipe,
		RouterLink,
		StatCard,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './member-detail.html',
	styleUrl: './member-detail.scss',
})
export class MemberDetailPage {
	private readonly accountFlagsApi = inject(AccountFlagsApi);
	private readonly membersApi = inject(MembersApi);
	private readonly moderationApi = inject(ModerationApi);
	private readonly statsApi = inject(StatsApi);
	private readonly auth = inject(AuthService);
	private readonly dialog = inject(MatDialog);
	private readonly notifications = inject(NotificationService);
	private readonly palette = inject(ChartPalette);
	private readonly formBuilder = inject(FormBuilder);
	private readonly destroyRef = inject(DestroyRef);

	/** Injecte depuis la route grace a `withComponentInputBinding`. */
	readonly userId = input.required<string>();

	readonly Permission = Permission;
	readonly statusLabels = MEMBER_STATUS_LABELS;
	readonly severityLabels = WARNING_SEVERITY_LABELS;
	readonly sanctionLabels = SANCTION_TYPE_LABELS;
	readonly periodLabels = STATS_PERIOD_LABELS;
	readonly periods = Object.keys(STATS_PERIOD_LABELS) as StatsPeriod[];
	readonly weekdays = WEEKDAY_LABELS;
	readonly roleColor = roleColorToHex;
	readonly timelineIcons = TIMELINE_ICONS;
	readonly accountFlagLabels = ACCOUNT_FLAG_TYPE_LABELS;
	readonly riskLabels: Record<string, string> = MODERATION_RISK_LABELS;

	/**
	 * Sous-titre de la vignette de score : le detail du calcul, pour qu'un
	 * total ne reste pas un nombre sans origine.
	 */
	scoreHint(score: ModerationScoreDto): string {
		if (score.total === 0) return 'Rien d’actif';
		return `${score.warnings} avertissement(s) + ${score.sanctions} sanction(s)`;
	}

	readonly loading = signal(true);
	readonly member = signal<MemberDetail | null>(null);
	readonly timeline = signal<TimelineEntry[]>([]);
	readonly notes = signal<NoteDto[]>([]);
	readonly warnings = signal<WarningDto[]>([]);
	readonly sanctions = signal<SanctionDto[]>([]);
	readonly accountFlags = signal<AccountFlagDto[]>([]);
	readonly voiceSessions = signal<VoiceSessionDto[]>([]);
	readonly activity = signal<MemberActivityStats | null>(null);
	readonly activityPeriod = signal<StatsPeriod>('90d');
	readonly savingNote = signal(false);
	/** Identifiant de la decision dont un envoi est en cours, pour desactiver son bouton. */
	readonly uploadingFor = signal<string | null>(null);

	readonly noteForm = this.formBuilder.nonNullable.group({
		body: ['', [Validators.required, Validators.maxLength(4000)]],
		pinned: [false],
	});

	readonly displayName = computed(() => {
		const member = this.member();
		if (!member) return '';
		return member.globalName ?? member.nickname ?? member.username;
	});

	readonly messagesChart = computed(() => {
		const stats = this.activity();
		if (!stats) return {};
		return timeSeriesOptions(this.palette.tokens(), [
			{ name: 'Messages', points: stats.messagesPerDay, area: true },
		]);
	});

	readonly voiceChart = computed(() => {
		const stats = this.activity();
		if (!stats) return {};
		return timeSeriesOptions(this.palette.tokens(), [
			{ name: 'Minutes en vocal', points: stats.voiceMinutesPerDay, area: true },
		]);
	});

	readonly channelsChart = computed(() => {
		const stats = this.activity();
		if (!stats) return {};
		// Limite aux dix canaux les plus actifs : au-dela, les barres deviennent
		// illisibles et n'apportent plus rien.
		return barOptions(this.palette.tokens(), stats.messagesByChannel.slice(0, 10), {
			horizontal: true,
		});
	});

	readonly hoursChart = computed(() => {
		const stats = this.activity();
		if (!stats) return {};
		return barOptions(this.palette.tokens(), stats.messagesByHour);
	});

	readonly heatmapChart = computed(() => {
		const stats = this.activity();
		if (!stats) return {};
		return heatmapOptions(this.palette.tokens(), stats.heatmap, WEEKDAY_LABELS);
	});

	/** Roles marques separateurs, charges seulement pour qui peut les ajouter. */
	readonly separators = signal<RoleSummary[]>([]);
	readonly addingSeparators = signal(false);

	readonly missingSeparators = computed(() => {
		const porte = new Set(this.member()?.roles.map((role) => role.id) ?? []);
		return this.separators().filter((role) => !porte.has(role.id));
	});

	readonly separatorsHint = computed(() => {
		if (this.member()?.status !== 'ACTIVE') return 'Le membre n’est plus sur le serveur.';
		if (!this.missingSeparators().length) return 'Le membre porte déjà tous les séparateurs.';
		return '';
	});

	readonly hasActivity = computed(() => (this.activity()?.totals.messages ?? 0) > 0);
	readonly hasVoice = computed(() => (this.activity()?.totals.voiceMinutes ?? 0) > 0);
	readonly hasHeatmap = computed(() => (this.activity()?.heatmap.length ?? 0) > 0);

	constructor() {
		// Recharge tout quand l'identifiant de route change : sans cela, naviguer
		// d'une fiche a une autre garderait les donnees du membre precedent.
		effect(() => {
			const userId = this.userId();
			this.loadMember(userId);
			this.loadActivity(userId);
		});

		if (this.canWrite(Permission.MEMBER_ROLES_WRITE)) {
			this.membersApi.listRoles().subscribe({
				next: (roles) => this.separators.set(roles.filter((role) => role.separator)),
			});
		}
	}

	/**
	 * Demande l'ajout de separateurs.
	 *
	 * L'API ne fait que deposer la demande : c'est le bot qui pose les roles, a
	 * son passage suivant (cinq secondes au plus). La fiche est relue un peu
	 * apres, sans quoi le moderateur verrait le bouton toujours actif et
	 * recliquerait.
	 */
	addSeparators(roles: RoleSummary[]): void {
		const userId = this.userId();
		this.addingSeparators.set(true);

		this.membersApi.addSeparators(userId, { roleIds: roles.map((role) => role.id) }).subscribe({
			next: (request) => {
				this.notifications.success(
					`${request.roleIds.length} séparateur(s) demandé(s) : le bot les ajoute dans quelques secondes.`,
				);
				timer(SEPARATOR_RELOAD_DELAY_MS)
					.pipe(takeUntilDestroyed(this.destroyRef))
					.subscribe(() => {
						this.addingSeparators.set(false);
						if (this.userId() === userId) this.loadMember(userId);
					});
			},
			error: () => this.addingSeparators.set(false),
		});
	}

	changeActivityPeriod(period: StatsPeriod): void {
		this.activityPeriod.set(period);
		this.loadActivity(this.userId());
	}

	openWarningDialog(): void {
		const member = this.member();
		if (!member) return;

		this.dialog
			.open(WarningDialog, {
				data: { userId: member.userId, memberLabel: this.displayName() },
			})
			.afterClosed()
			.subscribe((created) => {
				if (created) this.loadMember(member.userId);
			});
	}

	openSanctionDialog(): void {
		const member = this.member();
		if (!member) return;

		this.dialog
			.open(SanctionDialog, {
				data: { userId: member.userId, memberLabel: this.displayName() },
			})
			.afterClosed()
			.subscribe((created) => {
				if (created) this.loadMember(member.userId);
			});
	}

	revokeWarning(warning: WarningDto): void {
		const data: ConfirmDialogData = {
			title: "Lever l'avertissement",
			message: `Avertissement du ${new Date(warning.createdAt).toLocaleDateString('fr-FR')} : ${warning.reason}`,
			confirmLabel: 'Lever',
			reasonLabel: 'Motif de la levée',
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((reason) => {
				if (typeof reason !== 'string') return;

				this.moderationApi.revokeWarning(warning.id, { reason }).subscribe({
					next: () => {
						this.notifications.success('Avertissement levé.');
						this.loadMember(this.userId());
					},
				});
			});
	}

	revokeSanction(sanction: SanctionDto): void {
		const data: ConfirmDialogData = {
			title: 'Lever la sanction',
			message: `${this.sanctionLabels[sanction.type]} : ${sanction.reason}`,
			confirmLabel: 'Lever',
			destructive: true,
			reasonLabel: 'Motif de la levée',
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((reason) => {
				if (typeof reason !== 'string') return;

				this.moderationApi.revokeSanction(sanction.id, { reason }).subscribe({
					next: () => {
						this.notifications.success('Sanction levée.');
						this.loadMember(this.userId());
					},
				});
			});
	}

	addNote(): void {
		if (this.noteForm.invalid || this.savingNote()) {
			this.noteForm.markAllAsTouched();
			return;
		}

		this.savingNote.set(true);
		const { body, pinned } = this.noteForm.getRawValue();

		this.moderationApi.createNote({ userId: this.userId(), body, pinned }).subscribe({
			next: () => {
				this.noteForm.reset({ body: '', pinned: false });
				this.savingNote.set(false);
				this.notifications.success('Note ajoutée.');
				this.reloadNotes();
			},
			error: () => this.savingNote.set(false),
		});
	}

	togglePin(note: NoteDto): void {
		this.moderationApi
			.updateNote(note.id, { pinned: !note.pinned })
			.subscribe({ next: () => this.reloadNotes() });
	}

	deleteNote(note: NoteDto): void {
		const data: ConfirmDialogData = {
			title: 'Supprimer la note',
			message: 'Cette note ne sera plus visible dans la fiche du membre.',
			confirmLabel: 'Supprimer',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.moderationApi.deleteNote(note.id).subscribe({
					next: () => {
						this.notifications.success('Note supprimée.');
						this.reloadNotes();
					},
				});
			});
	}

	/**
	 * Ajout d'une piece jointe apres coup.
	 *
	 * Un `<input type="file">` cree a la volee plutot qu'un par ligne : la fiche
	 * peut afficher des dizaines d'avertissements et de sanctions, et autant
	 * d'elements caches ne serviraient qu'une fois chacun.
	 *
	 * `spoiler` est decide par le bouton employe, pas demande apres coup : une
	 * question posee une fois le fichier choisi arriverait trop tard pour la
	 * seule chose qu'elle protege — l'affichage immediat de la vignette.
	 */
	pickAttachment(kind: ModerationTarget, targetId: string, spoiler = false): void {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = ATTACHMENT_ACCEPT;

		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (!file) return;

			if (file.size > MAX_MODERATION_ATTACHMENT_BYTES) {
				this.notifications.error(
					`Fichier trop volumineux (max ${Math.floor(MAX_MODERATION_ATTACHMENT_BYTES / 1024 / 1024)} Mo).`,
				);
				return;
			}

			this.uploadingFor.set(targetId);
			this.moderationApi.uploadAttachment(kind, targetId, file, spoiler).subscribe({
				next: () => {
					this.uploadingFor.set(null);
					this.notifications.success('Pièce jointe ajoutée.');
					this.loadMember(this.userId());
				},
				error: () => this.uploadingFor.set(null),
			});
		});

		input.click();
	}

	removeAttachment(kind: ModerationTarget, targetId: string, attachmentId: string): void {
		const data: ConfirmDialogData = {
			title: 'Supprimer la pièce jointe',
			message: 'Le fichier sera effacé définitivement de la base.',
			confirmLabel: 'Supprimer',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.moderationApi.deleteAttachment(kind, targetId, attachmentId).subscribe({
					next: () => {
						this.notifications.success('Pièce jointe supprimée.');
						this.loadMember(this.userId());
					},
				});
			});
	}

	canWrite(permission: Permission): boolean {
		return this.auth.hasPermission(permission);
	}

	private reloadNotes(): void {
		this.membersApi.notes(this.userId()).subscribe({
			next: (notes) => this.notes.set(notes),
		});
	}

	/**
	 * Toutes les sections de la fiche sont chargees ensemble.
	 *
	 * Les onglets partagent le meme membre : les charger a l'ouverture de chaque
	 * onglet ferait clignoter l'interface a chaque changement.
	 */
	private loadMember(userId: string): void {
		this.loading.set(true);

		forkJoin({
			member: this.membersApi.findOne(userId),
			timeline: this.membersApi.timeline(userId, { pageSize: 50 }),
			notes: this.canRead(Permission.NOTES_READ)
				? this.membersApi.notes(userId)
				: Promise.resolve([] as NoteDto[]),
			warnings: this.moderationApi.searchWarnings({ userId, pageSize: 50 }),
			sanctions: this.moderationApi.searchSanctions({ userId, pageSize: 50 }),
			accountFlags: this.canRead(Permission.ACCOUNT_FLAGS_READ)
				? this.accountFlagsApi
						.search({ userId, pageSize: 50 })
						.pipe(map((page) => page.items))
				: of([] as AccountFlagDto[]),
			voiceSessions: this.membersApi.voiceSessions(userId, { pageSize: 50 }),
		}).subscribe({
			next: (result) => {
				this.member.set(result.member);
				this.timeline.set(result.timeline.items);
				this.notes.set(result.notes);
				this.warnings.set(result.warnings.items);
				this.sanctions.set(result.sanctions.items);
				this.accountFlags.set(result.accountFlags);
				this.voiceSessions.set(result.voiceSessions.items);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}

	private canRead(permission: Permission): boolean {
		return this.auth.hasPermission(permission);
	}

	private loadActivity(userId: string): void {
		this.statsApi.memberActivity(userId, this.activityPeriod()).subscribe({
			next: (stats) => this.activity.set(stats),
			error: () => this.activity.set(null),
		});
	}
}
