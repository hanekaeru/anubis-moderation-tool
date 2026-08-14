import {
	ChangeDetectionStrategy,
	Component,
	computed,
	effect,
	inject,
	input,
	signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import {
	Permission,
	TICKET_CATEGORY_LABELS,
	TICKET_PRIORITY_LABELS,
	TICKET_STATUS_LABELS,
	TicketPriority,
	TicketStatus,
	type TicketAttachmentRef,
	type TicketDetail,
	type TicketEventDto,
} from '@anubis/shared';
import { TicketsApi } from '../../../core/api/tickets.api';
import { NotificationService } from '../../../core/notification.service';
import { MemberAvatar } from '../../../shared/components/member-avatar';
import { TicketAttachment } from '../../../shared/components/ticket-attachment';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { DurationPipe, FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';

/** Frequence du rafraichissement silencieux : suivi "en direct" sans WebSocket. */
const POLL_INTERVAL_MS = 5_000;

// Valeurs possiblement absentes : un type d'evenement ajoute cote API doit
// degrader proprement plutot que d'afficher une case vide.
const EVENT_LABELS: Record<string, string | undefined> = {
	OPENED: 'Ticket ouvert',
	CLAIMED: 'Pris en charge',
	ASSIGNED: 'Assignation modifiee',
	MESSAGE: 'Message',
	STATUS_CHANGED: 'Statut modifie',
	PRIORITY_CHANGED: 'Priorite modifiee',
	INTERNAL_NOTE: 'Note interne',
	CLOSED: 'Ticket ferme',
	REOPENED: 'Ticket rouvert',
	TRANSCRIPT_ARCHIVED: 'Salon supprime',
};

const EVENT_ICONS: Record<string, string | undefined> = {
	OPENED: 'play_circle',
	CLAIMED: 'pan_tool',
	ASSIGNED: 'person_add',
	MESSAGE: 'chat_bubble',
	STATUS_CHANGED: 'swap_horiz',
	PRIORITY_CHANGED: 'priority_high',
	INTERNAL_NOTE: 'sticky_note_2',
	CLOSED: 'check_circle',
	REOPENED: 'restart_alt',
	TRANSCRIPT_ARCHIVED: 'delete_sweep',
};

@Component({
	selector: 'app-ticket-detail',
	imports: [
		DurationPipe,
		FrDatePipe,
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatProgressBarModule,
		MatSelectModule,
		MatTooltipModule,
		MemberAvatar,
		ReactiveFormsModule,
		RelativeTimePipe,
		RouterLink,
		TicketAttachment,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './ticket-detail.html',
	styleUrl: './ticket-detail.scss',
})
export class TicketDetailPage {
	private readonly ticketsApi = inject(TicketsApi);
	private readonly notifications = inject(NotificationService);
	private readonly formBuilder = inject(FormBuilder);

	readonly id = input.required<string>();

	readonly Permission = Permission;
	readonly statusLabels = TICKET_STATUS_LABELS;
	readonly priorityLabels = TICKET_PRIORITY_LABELS;
	readonly categoryLabels = TICKET_CATEGORY_LABELS;
	readonly statuses = Object.values(TicketStatus);
	readonly priorities = Object.values(TicketPriority);
	readonly eventLabels = EVENT_LABELS;
	readonly eventIcons = EVENT_ICONS;

	readonly loading = signal(true);
	readonly ticket = signal<TicketDetail | null>(null);
	readonly savingNote = signal(false);

	readonly noteForm = this.formBuilder.nonNullable.group({
		body: ['', [Validators.required, Validators.maxLength(4000)]],
	});

	/** Delai entre l'ouverture et la fermeture, quand le ticket est clos. */
	readonly resolutionLabel = computed(() => this.ticket()?.resolutionSeconds ?? null);

	constructor() {
		effect(() => this.load(this.id()));

		// Suivi "en direct" du fil : pas de WebSocket/SSE dans ce projet, un
		// rafraichissement silencieux (sans toucher `loading`, pour ne pas faire
		// clignoter la page) suffit pour un fil de ticket.
		interval(POLL_INTERVAL_MS)
			.pipe(takeUntilDestroyed())
			.subscribe(() => this.refreshSilently());
	}

	changeStatus(status: TicketStatus): void {
		this.update({ status });
	}

	changePriority(priority: TicketPriority): void {
		this.update({ priority });
	}

	addNote(): void {
		if (this.noteForm.invalid || this.savingNote()) {
			this.noteForm.markAllAsTouched();
			return;
		}

		this.savingNote.set(true);

		this.ticketsApi.addNote(this.id(), { body: this.noteForm.getRawValue().body }).subscribe({
			next: (ticket) => {
				this.ticket.set(ticket);
				this.noteForm.reset({ body: '' });
				this.savingNote.set(false);
				this.notifications.success('Note ajoutee au ticket.');
			},
			error: () => this.savingNote.set(false),
		});
	}

	/** Contenu affichable d'un evenement, selon son type. */
	eventDetail(event: TicketEventDto): string | null {
		const payload = event.payload;
		if (!payload) return null;

		if (typeof payload['body'] === 'string') return payload['body'];

		if (payload['from'] !== undefined || payload['to'] !== undefined) {
			return `${payload['from'] ?? '(aucun)'} → ${payload['to'] ?? '(aucun)'}`;
		}

		return null;
	}

	/** Texte d'un message Discord suivi dans le fil (evenement MESSAGE uniquement). */
	messageContent(event: TicketEventDto): string | null {
		const content = event.payload?.['content'];
		return typeof content === 'string' ? content : null;
	}

	/** Pieces jointes d'un message Discord suivi dans le fil. */
	messageAttachments(event: TicketEventDto): TicketAttachmentRef[] {
		const attachments = event.payload?.['attachments'];
		return Array.isArray(attachments) ? (attachments as TicketAttachmentRef[]) : [];
	}

	private update(changes: { status?: TicketStatus; priority?: TicketPriority }): void {
		this.ticketsApi.update(this.id(), changes).subscribe({
			next: (ticket) => {
				this.ticket.set(ticket);
				this.notifications.success('Ticket mis a jour.');
			},
		});
	}

	private load(id: string): void {
		this.loading.set(true);

		this.ticketsApi.findOne(id).subscribe({
			next: (ticket) => {
				this.ticket.set(ticket);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}

	/** Rafraichissement periodique du fil, sans spinner ni interruption de saisie. */
	private refreshSilently(): void {
		if (this.loading()) return;

		this.ticketsApi.findOne(this.id()).subscribe({
			next: (ticket) => this.ticket.set(ticket),
			error: () => undefined,
		});
	}
}
