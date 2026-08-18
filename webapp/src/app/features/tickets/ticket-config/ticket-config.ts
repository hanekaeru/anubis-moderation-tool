import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
	MAX_MAX_OPEN_TICKETS,
	MIN_MAX_OPEN_TICKETS,
	Permission,
	TICKET_CATEGORY_LABELS,
	TICKET_PRIORITY_LABELS,
	TicketCategory,
	TicketPriority,
	type TicketModeratorPrefixDto,
	type TicketSubjectDto,
} from '@anubis/shared';
import { TicketsApi } from '../../../core/api/tickets.api';
import { NotificationService } from '../../../core/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RelativeTimePipe } from '../../../shared/pipes/format.pipes';

/**
 * Reglages des tickets : sujets proposes a l'ouverture, prefixes de nommage
 * des moderateurs, et nombre de tickets ouverts autorises par membre.
 *
 * Les prefixes ne se creent pas ici : ils naissent de `/prefix_ticket` cote
 * Discord, ou le moderateur choisit lui-meme le sien. Cette page les corrige
 * et les retire, elle n'invente pas de moderateur.
 */
@Component({
	selector: 'app-ticket-config',
	imports: [
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatSelectModule,
		MatSlideToggleModule,
		MatTooltipModule,
		ReactiveFormsModule,
		RelativeTimePipe,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './ticket-config.html',
	styleUrl: './ticket-config.scss',
})
export class TicketConfigPage {
	private readonly ticketsApi = inject(TicketsApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);

	readonly Permission = Permission;
	readonly categories = Object.values(TicketCategory);
	readonly priorities = Object.values(TicketPriority);
	// Indexes depuis le template, ou les lignes arrivent typees `any`.
	readonly categoryLabels: Record<string, string> = TICKET_CATEGORY_LABELS;
	readonly priorityLabels: Record<string, string> = TICKET_PRIORITY_LABELS;

	readonly subjects = signal<TicketSubjectDto[]>([]);
	readonly prefixes = signal<TicketModeratorPrefixDto[]>([]);
	readonly saving = signal(false);

	readonly configForm = this.formBuilder.nonNullable.group({
		maxOpenTickets: [
			1,
			[
				Validators.required,
				Validators.min(MIN_MAX_OPEN_TICKETS),
				Validators.max(MAX_MAX_OPEN_TICKETS),
			],
		],
	});

	readonly subjectForm = this.formBuilder.nonNullable.group({
		label: ['', [Validators.required, Validators.maxLength(80)]],
		description: ['', [Validators.maxLength(100)]],
		emoji: [''],
		category: [TicketCategory.OTHER as TicketCategory],
		defaultPriority: [TicketPriority.NORMAL as TicketPriority],
	});

	constructor() {
		this.load();
	}

	save(): void {
		if (this.configForm.invalid) {
			this.configForm.markAllAsTouched();
			return;
		}

		this.saving.set(true);
		this.ticketsApi.updateConfig(this.configForm.getRawValue()).subscribe({
			next: () => {
				this.saving.set(false);
				this.notifications.success('Limite de tickets enregistrée.');
			},
			error: () => this.saving.set(false),
		});
	}

	addSubject(): void {
		if (this.subjectForm.invalid) {
			this.subjectForm.markAllAsTouched();
			return;
		}

		const raw = this.subjectForm.getRawValue();

		this.ticketsApi
			.createSubject({
				label: raw.label,
				description: raw.description.trim() || null,
				emoji: raw.emoji.trim() || null,
				category: raw.category,
				defaultPriority: raw.defaultPriority,
			})
			.subscribe({
				next: () => {
					this.subjectForm.reset({
						label: '',
						description: '',
						emoji: '',
						category: TicketCategory.OTHER,
						defaultPriority: TicketPriority.NORMAL,
					});
					this.loadSubjects();
				},
			});
	}

	toggleSubject(subject: TicketSubjectDto): void {
		this.ticketsApi
			.updateSubject(subject.id, { enabled: !subject.enabled })
			.subscribe({ next: () => this.loadSubjects() });
	}

	/**
	 * Retire un sujet de la liste.
	 *
	 * Les tickets deja ouverts gardent leur intitule : le libelle a ete copie
	 * a l'ouverture. Desactiver reste preferable quand on veut garder le lien
	 * pour les statistiques.
	 */
	removeSubject(subject: TicketSubjectDto): void {
		this.ticketsApi.deleteSubject(subject.id).subscribe({
			next: () => {
				this.notifications.success(
					`Sujet « ${subject.label} » retiré. Les tickets déjà ouverts gardent leur intitulé.`,
				);
				this.loadSubjects();
			},
		});
	}

	savePrefix(prefix: TicketModeratorPrefixDto, value: string): void {
		const saisi = value.trim();
		if (!saisi || saisi === prefix.prefix) return;

		this.ticketsApi.upsertPrefix(prefix.userId, { prefix: saisi }).subscribe({
			next: (mis) => {
				// Le serveur normalise : reafficher sa valeur plutot que la saisie
				// evite de laisser croire qu'un « Hané » a ete enregistre tel quel.
				this.notifications.success(`Préfixe enregistré : ${mis.prefix}`);
				this.loadPrefixes();
			},
			error: () => this.loadPrefixes(),
		});
	}

	removePrefix(prefix: TicketModeratorPrefixDto): void {
		this.ticketsApi.deletePrefix(prefix.userId).subscribe({
			next: () => {
				this.notifications.success(
					`Préfixe de ${prefix.username} retiré. Il devra relancer /prefix_ticket pour reprendre des tickets.`,
				);
				this.loadPrefixes();
			},
		});
	}

	private load(): void {
		this.ticketsApi.getConfig().subscribe({
			next: (config) =>
				this.configForm.setValue({ maxOpenTickets: config.maxOpenTickets }),
		});
		this.loadSubjects();
		this.loadPrefixes();
	}

	private loadSubjects(): void {
		this.ticketsApi
			.listSubjects()
			.subscribe({ next: (subjects) => this.subjects.set(subjects) });
	}

	private loadPrefixes(): void {
		this.ticketsApi
			.listPrefixes()
			.subscribe({ next: (prefixes) => this.prefixes.set(prefixes) });
	}
}
