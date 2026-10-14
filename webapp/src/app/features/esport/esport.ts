import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	computed,
	inject,
	signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin, timer, type Subscription } from 'rxjs';
import {
	addDaysToKey,
	buildEsportWeekEmbeds,
	esportDayKey,
	esportDayLabel,
	esportFormatLabel,
	esportRegionLabel,
	esportWeekStart,
	isEsportNight,
	esportScoreSpoiler,
	ESPORT_PUBLICATION_STATUS_LABELS,
	ESPORT_TIME_ZONE,
	Permission,
	zonedTimeOfDay,
	type EsportConfigDto,
	type EsportMatchDto,
	type EsportPublicationStatus,
	type EsportTeamDto,
	type EsportWeekDto,
	type EsportWeekSummaryDto,
} from '@anubis/shared';
import { EsportApi } from '../../core/api/esport.api';
import { AuthService } from '../../core/auth/auth.service';
import { NotificationService } from '../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../shared/components/confirm-dialog';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { FrDatePipe } from '../../shared/pipes/format.pipes';
import { EsportConfigDialog } from './config-dialog';
import { customEmojiUrl } from './discord-markdown';
import { EsportEmbedPreview } from './embed-preview';
import { EsportImportDialog, type ImportDialogData } from './import-dialog';
import { EsportMatchDialog, type MatchDialogData } from './match-dialog';
import { EsportResultDialog, type ResultDialogData } from './result-dialog';
import { EsportTeamDialog, type TeamDialogData } from './team-dialog';

/** Delai entre deux relectures tant que le bot n'a pas traite un envoi. */
const POLL_MS = 5_000;
/** Au-dela, le bot est probablement arrete : inutile d'insister. */
const POLL_MAX = 12;

const EN_COURS: EsportPublicationStatus[] = ['PENDING', 'REMOVING'];

/**
 * Matchs esport de la semaine.
 *
 * Une semaine se compose ici, s'envoie d'un clic, puis se corrige au fil des
 * jours : chaque modification d'une semaine deja envoyee est repercutee par le
 * bot sur le message publie. Terminer un match publie en plus une annonce de
 * resultat, distincte du recapitulatif.
 *
 * L'apercu passe par `buildEsportWeekEmbeds`, la fonction du bot.
 */
@Component({
	selector: 'app-esport',
	imports: [
		EsportEmbedPreview,
		FrDatePipe,
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatMenuModule,
		MatProgressBarModule,
		MatSelectModule,
		MatSlideToggleModule,
		MatTooltipModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './esport.html',
	styleUrl: './esport.scss',
})
export class EsportPage {
	private readonly api = inject(EsportApi);
	private readonly auth = inject(AuthService);
	private readonly dialog = inject(MatDialog);
	private readonly notifications = inject(NotificationService);
	private readonly destroyRef = inject(DestroyRef);

	readonly Permission = Permission;
	readonly statusLabels: Record<string, string> = ESPORT_PUBLICATION_STATUS_LABELS;
	readonly emojiUrl = customEmojiUrl;
	readonly canWrite = this.auth.hasPermission(Permission.ESPORT_WRITE);
	readonly canManage = this.auth.hasPermission(Permission.ESPORT_MANAGE);

	readonly weekStart = signal(esportWeekStart(new Date()));
	readonly week = signal<EsportWeekDto | null>(null);
	readonly config = signal<EsportConfigDto | null>(null);
	readonly teams = signal<EsportTeamDto[]>([]);
	readonly history = signal<EsportWeekSummaryDto[]>([]);
	readonly loading = signal(true);
	readonly busy = signal(false);
	readonly showArchived = signal(false);

	private poll?: Subscription;
	private pollCount = 0;

	readonly details = inject(FormBuilder).nonNullable.group({
		title: ['', [Validators.maxLength(200)]],
		description: ['', [Validators.maxLength(1000)]],
	});

	readonly weekLabel = computed(
		() =>
			`Du ${esportDayLabel(this.weekStart()).toLowerCase()} au ${esportDayLabel(
				addDaysToKey(this.weekStart(), 6),
			).toLowerCase()}`,
	);

	readonly isCurrentWeek = computed(
		() => this.weekStart() === esportWeekStart(new Date()),
	);

	readonly activeTeams = computed(() => this.teams().filter((team) => !team.archived));
	readonly visibleTeams = computed(() =>
		this.showArchived() ? this.teams() : this.activeTeams(),
	);
	readonly archivedCount = computed(() => this.teams().filter((team) => team.archived).length);

	readonly preview = computed(() => {
		const week = this.week();
		const config = this.config();
		if (!week || !config) return null;

		return buildEsportWeekEmbeds(
			{
				weekStart: week.weekStart,
				title: week.title,
				description: week.description,
				matches: week.matches,
			},
			config,
		);
	});

	/** Mention envoyee avec le recapitulatif, au premier envoi seulement. */
	readonly previewContent = computed(() => {
		const config = this.config();
		return config?.mentionRoleId && config.mentionOnPublish ? `<@&${config.mentionRoleId}>` : null;
	});

	readonly missingChannel = computed(() => this.config() !== null && !this.config()!.channelId);

	/** Jeton configure sur l'API et au moins une ligue reglee. */
	readonly canImport = computed(() => {
		const pandascore = this.config()?.pandascore;
		return !!pandascore?.available && pandascore.leagueIds.length > 0;
	});

	constructor() {
		this.destroyRef.onDestroy(() => this.poll?.unsubscribe());

		forkJoin({ config: this.api.getConfig(), teams: this.api.listTeams() }).subscribe({
			next: ({ config, teams }) => {
				this.config.set(config);
				this.teams.set(teams);
			},
		});

		this.loadHistory();
		this.loadWeek();
	}

	// --- Navigation -----------------------------------------------------------

	shiftWeek(weeks: number): void {
		this.goTo(addDaysToKey(this.weekStart(), weeks * 7));
	}

	goToCurrent(): void {
		this.goTo(esportWeekStart(new Date()));
	}

	goTo(weekStart: string): void {
		this.weekStart.set(weekStart);
		this.loadWeek();
	}

	historyLabel(summary: EsportWeekSummaryDto): string {
		return `Semaine du ${esportDayLabel(summary.weekStart).toLowerCase()} · ${summary.matchCount} match(s) · ${
			this.statusLabels[summary.status]
		}`;
	}

	// --- Semaine --------------------------------------------------------------

	createWeek(): void {
		this.busy.set(true);
		this.api.createWeek(this.weekStart()).subscribe({
			next: (week) => {
				this.busy.set(false);
				this.applyWeek(week);
				this.loadHistory();
			},
			error: () => this.busy.set(false),
		});
	}

	saveDetails(): void {
		const week = this.week();
		if (!week || this.details.invalid) return;

		const raw = this.details.getRawValue();
		this.run(
			this.api.updateWeek(week.id, {
				title: raw.title.trim() || null,
				description: raw.description.trim() || null,
			}),
			week.status === 'DRAFT' ? 'Texte enregistré.' : 'Texte enregistré : le message publié sera corrigé.',
		);
	}

	publish(): void {
		const week = this.week();
		if (!week) return;
		this.run(
			this.api.publishWeek(week.id),
			week.messageId
				? 'Semaine remise en file : le message publié sera corrigé.'
				: 'Semaine envoyée : le bot la publie dans quelques secondes.',
		);
	}

	removeWeekMessage(): void {
		const week = this.week();
		if (!week) return;
		this.confirm(
			{
				title: 'Retirer le récapitulatif de Discord',
				message:
					'Le message sera supprimé du salon. La semaine reste enregistrée ici et pourra être renvoyée.',
				confirmLabel: 'Retirer',
				destructive: true,
			},
			() => this.run(this.api.removeWeekMessage(week.id), 'Retrait demandé au bot.'),
		);
	}

	deleteWeek(): void {
		const week = this.week();
		if (!week) return;
		this.confirm(
			{
				title: 'Supprimer la semaine',
				message:
					'La semaine et ses matchs seront effacés du dashboard. Les messages déjà publiés restent sur Discord.',
				confirmLabel: 'Supprimer',
				destructive: true,
			},
			() => {
				this.busy.set(true);
				this.api.deleteWeek(week.id).subscribe({
					next: () => {
						this.busy.set(false);
						this.applyWeek(null);
						this.loadHistory();
						this.notifications.success('Semaine supprimée.');
					},
					error: () => this.busy.set(false),
				});
			},
		);
	}

	// --- Matchs ---------------------------------------------------------------

	openMatch(match: EsportMatchDto | null = null): void {
		const week = this.week();
		if (!week) return;

		this.dialog
			.open<EsportMatchDialog, MatchDialogData, EsportWeekDto>(EsportMatchDialog, {
				data: { week, teams: this.teams(), match },
				width: '560px',
			})
			.afterClosed()
			.subscribe((updated) => {
				if (!updated) return;
				this.applyWeek(updated);
				this.notifications.success(match ? 'Match modifié.' : 'Match ajouté.');
			});
	}

	deleteMatch(match: EsportMatchDto): void {
		this.confirm(
			{
				title: 'Supprimer le match',
				message: `${this.matchTitle(match)} sera retiré de la semaine.${
					match.result?.messageId ? ' Son annonce de résultat reste sur Discord.' : ''
				}`,
				confirmLabel: 'Supprimer',
				destructive: true,
			},
			() => this.run(this.api.deleteMatch(match.id), 'Match supprimé.'),
		);
	}

	openImport(): void {
		const week = this.week();
		if (!week) return;

		this.dialog
			.open<EsportImportDialog, ImportDialogData, EsportWeekDto>(EsportImportDialog, {
				data: { week },
				width: '760px',
				maxWidth: '95vw',
			})
			.afterClosed()
			.subscribe((updated) => {
				if (!updated) return;
				this.applyWeek(updated);
				this.loadHistory();
				// Des equipes ont pu etre creees ou reliees.
				this.refreshTeams();
				this.notifications.success(
					updated.status === 'DRAFT'
						? 'Matchs importés : relisez-les avant d’envoyer.'
						: 'Matchs importés : le message publié sera corrigé.',
				);
			});
	}

	regionLabel(match: EsportMatchDto): string | null {
		return esportRegionLabel(match.region);
	}

	formatLabel(match: EsportMatchDto): string | null {
		return esportFormatLabel(match.format, match.bestOf);
	}

	openResult(match: EsportMatchDto): void {
		const config = this.config();
		if (!config) return;

		this.dialog
			.open<EsportResultDialog, ResultDialogData, EsportWeekDto>(EsportResultDialog, {
				data: { match, config },
				width: '600px',
			})
			.afterClosed()
			.subscribe((updated) => {
				if (!updated) return;
				this.applyWeek(updated);
				this.notifications.success(
					match.finished ? 'Score corrigé.' : 'Match terminé : le résultat va être annoncé.',
				);
			});
	}

	reopen(match: EsportMatchDto): void {
		this.confirm(
			{
				title: 'Rouvrir le match',
				message:
					'Le score est effacé et le match redevient « à venir ». L’annonce de résultat déjà publiée reste sur Discord ; elle sera corrigée si le match est terminé de nouveau.',
				confirmLabel: 'Rouvrir',
			},
			() => this.run(this.api.reopenMatch(match.id), 'Match rouvert.'),
		);
	}

	removeResult(match: EsportMatchDto): void {
		this.confirm(
			{
				title: "Retirer l'annonce de résultat",
				message: 'Le message de résultat sera supprimé du salon. Le score reste enregistré.',
				confirmLabel: 'Retirer',
				destructive: true,
			},
			() => this.run(this.api.removeResultMessage(match.id), 'Retrait demandé au bot.'),
		);
	}

	matchTitle(match: EsportMatchDto): string {
		return `${match.teamA?.name ?? 'À déterminer'} vs ${match.teamB?.name ?? 'À déterminer'}`;
	}

	matchDay(match: EsportMatchDto): string {
		return esportDayLabel(esportDayKey(new Date(match.scheduledAt)));
	}

	matchTime(match: EsportMatchDto): string {
		const instant = new Date(match.scheduledAt);
		return (isEsportNight(instant) ? '🌙 ' : '') + zonedTimeOfDay(instant, ESPORT_TIME_ZONE);
	}

	isSpoiler(match: EsportMatchDto): boolean {
		const config = this.config();
		return config ? esportScoreSpoiler(match, config) : true;
	}

	// --- Equipes --------------------------------------------------------------

	openTeam(team: EsportTeamDto | null = null): void {
		this.dialog
			.open<EsportTeamDialog, TeamDialogData, EsportTeamDto>(EsportTeamDialog, {
				data: team,
				width: '480px',
			})
			.afterClosed()
			.subscribe((saved) => {
				if (!saved) return;
				this.refreshTeams();
				// Le nom ou l'emoji ont pu changer sur des matchs affiches.
				if (team) this.loadWeek();
				this.notifications.success(team ? 'Équipe modifiée.' : 'Équipe ajoutée.');
			});
	}

	removeTeam(team: EsportTeamDto): void {
		this.confirm(
			{
				title: `Retirer ${team.name}`,
				message:
					'Une équipe qui a déjà joué est archivée : elle reste affichée sur les semaines passées mais n’est plus proposée. Sinon, elle est supprimée.',
				confirmLabel: 'Retirer',
				destructive: true,
			},
			() =>
				this.api.removeTeam(team.id).subscribe({
					next: ({ archived }) => {
						this.refreshTeams();
						this.notifications.success(archived ? 'Équipe archivée.' : 'Équipe supprimée.');
					},
				}),
		);
	}

	restoreTeam(team: EsportTeamDto): void {
		this.api.restoreTeam(team.id).subscribe({
			next: () => {
				this.refreshTeams();
				this.notifications.success('Équipe restaurée.');
			},
		});
	}

	openConfig(): void {
		const config = this.config();
		if (!config) return;

		this.dialog
			.open<EsportConfigDialog, EsportConfigDto, EsportConfigDto>(EsportConfigDialog, {
				data: config,
				width: '520px',
			})
			.afterClosed()
			.subscribe((saved) => {
				if (!saved) return;
				this.config.set(saved);
				this.notifications.success('Réglages enregistrés.');
			});
	}

	// --- Interne --------------------------------------------------------------

	private run(appel: ReturnType<EsportApi['publishWeek']>, message: string): void {
		this.busy.set(true);
		appel.subscribe({
			next: (week) => {
				this.busy.set(false);
				this.applyWeek(week);
				this.loadHistory();
				this.notifications.success(message);
			},
			error: () => this.busy.set(false),
		});
	}

	private confirm(data: ConfirmDialogData, action: () => void): void {
		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed) action();
			});
	}

	private refreshTeams(): void {
		this.api.listTeams().subscribe({ next: (teams) => this.teams.set(teams) });
	}

	private loadHistory(): void {
		this.api.listWeeks().subscribe({ next: (weeks) => this.history.set(weeks) });
	}

	private loadWeek(): void {
		const demandee = this.weekStart();
		this.loading.set(true);
		this.pollCount = 0;

		this.api.getWeek(demandee).subscribe({
			next: ({ week }) => {
				// Une reponse lente ne doit pas ecraser la semaine affichee depuis.
				if (this.weekStart() !== demandee) return;
				this.loading.set(false);
				this.applyWeek(week);
			},
			error: () => this.loading.set(false),
		});
	}

	/**
	 * Applique une semaine et, si le bot a encore du travail en cours, relit
	 * dans quelques secondes : sans cela le moderateur verrait « En attente du
	 * bot » indefiniment et recliquerait.
	 */
	private applyWeek(week: EsportWeekDto | null, fromPoll = false): void {
		this.week.set(week);
		// Une relecture automatique n'ecrase pas un texte en cours de saisie.
		if (!fromPoll || this.details.pristine) {
			this.details.reset({ title: week?.title ?? '', description: week?.description ?? '' });
		}
		if (!this.canWrite) this.details.disable();

		this.poll?.unsubscribe();
		const enAttente =
			!!week &&
			(EN_COURS.includes(week.status) ||
				week.matches.some((match) => match.result && EN_COURS.includes(match.result.status)));

		if (enAttente && this.pollCount < POLL_MAX) {
			this.pollCount++;
			const demandee = this.weekStart();
			this.poll = timer(POLL_MS).subscribe(() => {
				this.api.getWeek(demandee).subscribe({
					next: ({ week: fraiche }) => {
						if (this.weekStart() === demandee) this.applyWeek(fraiche, true);
					},
				});
			});
		} else if (!enAttente) {
			this.pollCount = 0;
		}
	}
}
