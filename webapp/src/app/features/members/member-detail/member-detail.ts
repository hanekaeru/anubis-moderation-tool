import {
	ChangeDetectionStrategy,
	Component,
	computed,
	effect,
	inject,
	input,
	signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
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
import { forkJoin } from 'rxjs';
import {
	MEMBER_STATUS_LABELS,
	Permission,
	SANCTION_TYPE_LABELS,
	STATS_PERIOD_LABELS,
	WARNING_SEVERITY_LABELS,
	WEEKDAY_LABELS,
	roleColorToHex,
	type MemberActivityStats,
	type MemberDetail,
	type NoteDto,
	type SanctionDto,
	type StatsPeriod,
	type TimelineEntry,
	type WarningDto,
} from '@anubis/shared';
import { MembersApi } from '../../../core/api/members.api';
import { ModerationApi } from '../../../core/api/moderation.api';
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
import { StatCard } from '../../../shared/components/stat-card';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { DurationPipe, FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';
import { SanctionDialog } from '../../moderation/dialogs/sanction-dialog';
import { WarningDialog } from '../../moderation/dialogs/warning-dialog';

/**
 * Icone associee a chaque type d'evenement de la chronologie. Valeurs
 * possiblement absentes : un type ajoute cote API doit degrader proprement.
 */
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
		MatProgressBarModule,
		MatSlideToggleModule,
		MatTabsModule,
		MatTooltipModule,
		MemberAvatar,
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
	private readonly membersApi = inject(MembersApi);
	private readonly moderationApi = inject(ModerationApi);
	private readonly statsApi = inject(StatsApi);
	private readonly auth = inject(AuthService);
	private readonly dialog = inject(MatDialog);
	private readonly notifications = inject(NotificationService);
	private readonly palette = inject(ChartPalette);
	private readonly formBuilder = inject(FormBuilder);

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

	readonly loading = signal(true);
	readonly member = signal<MemberDetail | null>(null);
	readonly timeline = signal<TimelineEntry[]>([]);
	readonly notes = signal<NoteDto[]>([]);
	readonly warnings = signal<WarningDto[]>([]);
	readonly sanctions = signal<SanctionDto[]>([]);
	readonly activity = signal<MemberActivityStats | null>(null);
	readonly activityPeriod = signal<StatsPeriod>('90d');
	readonly savingNote = signal(false);

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
			reasonLabel: 'Motif de la levee',
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((reason) => {
				if (typeof reason !== 'string') return;

				this.moderationApi.revokeWarning(warning.id, { reason }).subscribe({
					next: () => {
						this.notifications.success('Avertissement leve.');
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
			reasonLabel: 'Motif de la levee',
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((reason) => {
				if (typeof reason !== 'string') return;

				this.moderationApi.revokeSanction(sanction.id, { reason }).subscribe({
					next: () => {
						this.notifications.success('Sanction levee.');
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
				this.notifications.success('Note ajoutee.');
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
						this.notifications.success('Note supprimee.');
						this.reloadNotes();
					},
				});
			});
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
		}).subscribe({
			next: (result) => {
				this.member.set(result.member);
				this.timeline.set(result.timeline.items);
				this.notes.set(result.notes);
				this.warnings.set(result.warnings.items);
				this.sanctions.set(result.sanctions.items);
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
