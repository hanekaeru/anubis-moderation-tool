import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
	MINIGAME_EVENT_STATE_LABELS,
	MINIGAME_TYPE_EMOJIS,
	MINIGAME_TYPE_LABELS,
	Permission,
	addDaysToKey,
	minigameDayKey,
	minigameEventState,
	mondayOfKey,
	weekdayOfKey,
	type MinigameCalendarDto,
	type MinigameConfigDto,
	type MinigameEventDto,
	type MinigameEventState,
	type MinigameType,
} from '@anubis/shared';
import { MinigamesApi } from '../../core/api/minigames.api';
import { AuthService } from '../../core/auth/auth.service';
import { NotificationService } from '../../core/notification.service';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { MinigameConfigDialog } from './config-dialog';
import { MinigameEventDialog, type EventDialogData } from './event-dialog';
import { MinigameMapsDialog } from './maps-dialog';

interface Cell {
	key: string;
	day: number;
	inMonth: boolean;
	isToday: boolean;
	event: MinigameEventDto | null;
	state: MinigameEventState | null;
	/** Type que la semaine type propose pour ce jour, s'il est vide. */
	suggested: MinigameType | null;
	/** Un clic ouvre quelque chose : un jeu existant, ou une creation permise. */
	clickable: boolean;
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Premier jour du mois suivant, en cle « AAAA-MM-01 ». */
function nextMonth(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}`;
}

function previousMonth(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, '0')}`;
}

/**
 * Calendrier des mini-jeux : un jeu par jour, prepare jusqu'a la veille 23:59.
 *
 * La page montre les reponses — c'est le staff qui les choisit. Le jour meme et
 * le passe sont verrouilles : seul un administrateur (`minigames:manage`) peut
 * encore y toucher. L'API le refuse de toute facon, la page ne fait que griser.
 */
@Component({
	selector: 'app-minigames',
	imports: [HasPermissionDirective, MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule, MatTooltipModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './minigames.html',
	styleUrl: './minigames.scss',
})
export class MinigamesPage {
	private readonly api = inject(MinigamesApi);
	private readonly auth = inject(AuthService);
	private readonly dialog = inject(MatDialog);
	private readonly notifications = inject(NotificationService);

	readonly Permission = Permission;
	readonly weekdays = WEEKDAYS;
	readonly typeLabels: Record<string, string> = MINIGAME_TYPE_LABELS;
	readonly emojis: Record<string, string> = MINIGAME_TYPE_EMOJIS;
	readonly stateLabels: Record<string, string> = MINIGAME_EVENT_STATE_LABELS;

	readonly canWrite = this.auth.hasPermission(Permission.MINIGAMES_WRITE);
	readonly canManage = this.auth.hasPermission(Permission.MINIGAMES_MANAGE);

	readonly month = signal(minigameDayKey(new Date()).slice(0, 7));
	readonly loading = signal(true);
	readonly data = signal<MinigameCalendarDto | null>(null);

	readonly monthLabel = computed(() => {
		const label = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
			new Date(`${this.month()}-01T00:00:00Z`),
		);
		return label.charAt(0).toUpperCase() + label.slice(1);
	});

	/** Semaines completes, du lundi qui precede le 1er au dimanche qui suit le dernier jour. */
	private readonly range = computed(() => {
		const first = `${this.month()}-01`;
		const last = addDaysToKey(`${nextMonth(this.month())}-01`, -1);
		return { from: mondayOfKey(first), to: addDaysToKey(mondayOfKey(last), 6) };
	});

	readonly cells = computed<Cell[]>(() => {
		const data = this.data();
		const { from, to } = this.range();
		const today = data?.today ?? minigameDayKey(new Date());
		const byDay = new Map((data?.events ?? []).map((event) => [event.day, event]));
		const week = data?.config.weekTemplate ?? [];

		const cells: Cell[] = [];
		for (let key = from; key <= to; key = addDaysToKey(key, 1)) {
			const event = byDay.get(key) ?? null;
			const creatable = this.canWrite && (key > today || (key === today && this.canManage));
			cells.push({
				key,
				day: Number(key.slice(8)),
				inMonth: key.startsWith(this.month()),
				isToday: key === today,
				event,
				state: event ? minigameEventState(event, today) : null,
				suggested: event ? null : (week[weekdayOfKey(key)] ?? null),
				clickable: !!event || creatable,
			});
		}
		return cells;
	});

	readonly missingAnnounceChannel = computed(() => {
		const config = this.data()?.config;
		return !!config && !config.announceChannelId;
	});

	constructor() {
		this.load();
	}

	load(): void {
		const { from, to } = this.range();
		this.loading.set(true);
		this.api.calendar(from, to).subscribe({
			next: (data) => {
				this.data.set(data);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}

	previous(): void {
		this.month.set(previousMonth(this.month()));
		this.load();
	}

	next(): void {
		this.month.set(nextMonth(this.month()));
		this.load();
	}

	thisMonth(): void {
		this.month.set(minigameDayKey(new Date()).slice(0, 7));
		this.load();
	}

	cellLabel(cell: Cell): string {
		const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
			new Date(`${cell.key}T00:00:00Z`),
		);
		if (cell.event) return `${date} : ${this.typeLabels[cell.event.type]}, ${this.stateLabels[cell.state!]}`;
		return cell.clickable ? `${date} : préparer un mini-jeu` : `${date} : aucun mini-jeu`;
	}

	open(cell: Cell): void {
		const data = this.data();
		if (!data || !cell.clickable) return;

		const event = cell.event;
		const readOnly = !this.canWrite || !!event?.closedAt || (!!event?.locked && !this.canManage);
		const dialogData: EventDialogData = {
			day: cell.key,
			today: data.today,
			event,
			defaultType: cell.suggested,
			config: data.config,
			heroes: data.heroes,
			maps: data.maps,
			readOnly,
		};

		this.dialog
			.open<MinigameEventDialog, EventDialogData, boolean>(MinigameEventDialog, {
				data: dialogData,
				width: '1100px',
				maxWidth: '95vw',
				autoFocus: false,
			})
			.afterClosed()
			.subscribe((changed) => {
				if (changed) this.load();
			});
	}

	openConfig(): void {
		const config = this.data()?.config;
		if (!config) return;
		this.dialog
			.open<MinigameConfigDialog, MinigameConfigDto, MinigameConfigDto>(MinigameConfigDialog, {
				data: config,
				maxWidth: '95vw',
			})
			.afterClosed()
			.subscribe((saved) => {
				if (!saved) return;
				this.notifications.success('Réglage enregistré — le bot le relira d’ici 30 secondes.');
				this.load();
			});
	}

	openMaps(): void {
		const maps = this.data()?.maps;
		if (!maps) return;
		this.dialog
			.open(MinigameMapsDialog, { data: maps, maxWidth: '95vw' })
			.afterClosed()
			.subscribe((changed) => {
				if (changed) this.load();
			});
	}
}
