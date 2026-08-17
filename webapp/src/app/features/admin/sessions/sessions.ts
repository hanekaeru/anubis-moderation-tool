import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { APP_USER_ROLE_LABELS, type SessionDto } from '@anubis/shared';
import { SessionsApi } from '../../../core/api/sessions.api';
import { NotificationService } from '../../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../../shared/components/confirm-dialog';
import { FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';

/**
 * Navigateur et systeme, lisibles.
 *
 * Le `User-Agent` complet est illisible et souvent trompeur ; ce qui compte ici
 * est de reconnaitre **sa** session parmi celles de l'equipe. Une detection
 * approximative suffit donc, et la chaine brute reste disponible en infobulle.
 */
function describeUserAgent(userAgent: string | null): string {
	if (!userAgent) return 'Client inconnu';

	// L'ordre compte : Edge et Opera se declarent aussi « Chrome », et Chrome se
	// declare « Safari ». Le plus specifique doit donc etre teste en premier.
	const browsers: [RegExp, string][] = [
		[/Edg\//, 'Edge'],
		[/OPR\/|Opera/, 'Opera'],
		[/Firefox\//, 'Firefox'],
		[/Chrome\//, 'Chrome'],
		[/Safari\//, 'Safari'],
	];

	const systems: [RegExp, string][] = [
		[/Windows/, 'Windows'],
		[/Android/, 'Android'],
		[/iPhone|iPad|iOS/, 'iOS'],
		[/Mac OS X|Macintosh/, 'macOS'],
		[/Linux/, 'Linux'],
	];

	const browser = browsers.find(([pattern]) => pattern.test(userAgent))?.[1];
	const system = systems.find(([pattern]) => pattern.test(userAgent))?.[1];

	if (browser && system) return `${browser} sur ${system}`;
	return browser ?? system ?? 'Client inconnu';
}

/**
 * Sessions ouvertes sur le dashboard.
 *
 * Page reservee au proprietaire : voir les traces de connexion de toute
 * l'equipe et couper n'importe qui n'est pas de l'administration courante.
 * `SESSIONS_READ` et `SESSIONS_REVOKE` sont absentes de la matrice par defaut,
 * c'est ce qui la ferme aux administrateurs.
 */
@Component({
	selector: 'app-sessions',
	imports: [
		FrDatePipe,
		MatButtonModule,
		MatCardModule,
		MatIconModule,
		MatProgressBarModule,
		MatSlideToggleModule,
		MatTooltipModule,
		RelativeTimePipe,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './sessions.html',
	styleUrl: './sessions.scss',
})
export class SessionsPage {
	private readonly sessionsApi = inject(SessionsApi);
	private readonly notifications = inject(NotificationService);
	private readonly dialog = inject(MatDialog);

	readonly roleLabels: Record<string, string> = APP_USER_ROLE_LABELS;

	readonly loading = signal(true);
	readonly sessions = signal<SessionDto[]>([]);
	readonly includeInactive = signal(false);

	/** Regroupe par compte : c'est ainsi qu'on lit « qui est connecté où ». */
	readonly groups = computed(() => {
		const byUser = new Map<string, SessionDto[]>();

		for (const session of this.sessions()) {
			const existing = byUser.get(session.appUserId);
			if (existing) existing.push(session);
			else byUser.set(session.appUserId, [session]);
		}

		return [...byUser.values()]
			.map((entries) => ({
				appUserId: entries[0]!.appUserId,
				displayName: entries[0]!.displayName,
				username: entries[0]!.username,
				role: entries[0]!.role,
				sessions: entries,
			}))
			.sort((a, b) => a.displayName.localeCompare(b.displayName));
	});

	constructor() {
		this.load();
	}

	describe(session: SessionDto): string {
		return describeUserAgent(session.userAgent);
	}

	toggleInactive(include: boolean): void {
		this.includeInactive.set(include);
		this.load();
	}

	revoke(session: SessionDto): void {
		const data: ConfirmDialogData = {
			title: 'Fermer cette session',
			message: `${session.displayName} sera déconnecté de ${this.describe(session)} et devra saisir ses identifiants à nouveau.`,
			confirmLabel: 'Fermer la session',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.sessionsApi.revoke(session.familyId).subscribe({
					next: () => {
						this.notifications.success('Session fermée.');
						this.load();
					},
				});
			});
	}

	revokeAll(group: { appUserId: string; displayName: string; sessions: SessionDto[] }): void {
		const data: ConfirmDialogData = {
			title: 'Fermer toutes les sessions',
			message: `Les ${group.sessions.length} session(s) de ${group.displayName} seront fermées. La vôtre, si elle en fait partie, est épargnée.`,
			confirmLabel: 'Tout fermer',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.sessionsApi.revokeAllForUser(group.appUserId).subscribe({
					next: (result) => {
						this.notifications.success(
							`${result.revoked} jeton(s) révoqué(s).`,
						);
						this.load();
					},
				});
			});
	}

	private load(): void {
		this.loading.set(true);

		this.sessionsApi
			.list({ includeInactive: this.includeInactive() || undefined })
			.subscribe({
				next: (sessions) => {
					this.sessions.set(sessions);
					this.loading.set(false);
				},
				error: () => this.loading.set(false),
			});
	}
}
