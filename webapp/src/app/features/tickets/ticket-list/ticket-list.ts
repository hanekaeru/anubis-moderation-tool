import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import {
	DEFAULT_PAGE_SIZE,
	TICKET_PRIORITY_LABELS,
	TICKET_STATUS_LABELS,
	TicketPriority,
	TicketStatus,
	type TicketListItem,
} from '@anubis/shared';
import { TicketsApi } from '../../../core/api/tickets.api';
import { MemberAvatar } from '../../../shared/components/member-avatar';
import { DurationPipe, FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';

@Component({
	selector: 'app-ticket-list',
	imports: [
		DurationPipe,
		FrDatePipe,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatPaginatorModule,
		MatProgressBarModule,
		MatSelectModule,
		MatTableModule,
		MatTooltipModule,
		MemberAvatar,
		ReactiveFormsModule,
		RelativeTimePipe,
		RouterLink,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './ticket-list.html',
	styleUrl: './ticket-list.scss',
})
export class TicketListPage {
	private readonly ticketsApi = inject(TicketsApi);
	private readonly formBuilder = inject(FormBuilder);

	// Index en `string` : les lignes de `mat-table` sont typees `any` dans le
	// template, un `Record` sur l'enum serait refuse a la compilation.
	readonly statusLabels: Record<string, string> = TICKET_STATUS_LABELS;
	readonly priorityLabels: Record<string, string> = TICKET_PRIORITY_LABELS;
	readonly statuses = Object.values(TicketStatus);
	readonly priorities = Object.values(TicketPriority);

	readonly columns = [
		'number',
		'subject',
		'opener',
		'assignee',
		'priority',
		'status',
		'firstResponse',
		'openedAt',
	];

	readonly loading = signal(false);
	readonly tickets = signal<TicketListItem[]>([]);
	readonly categories = signal<string[]>([]);
	readonly total = signal(0);
	readonly pageIndex = signal(0);
	readonly pageSize = signal(DEFAULT_PAGE_SIZE);

	readonly filters = this.formBuilder.group({
		search: [''],
		status: [null as TicketStatus | null],
		priority: [null as TicketPriority | null],
		category: [null as string | null],
	});

	constructor() {
		this.ticketsApi.listCategories().subscribe({
			next: (categories) => this.categories.set(categories),
			error: () => this.categories.set([]),
		});

		this.filters.valueChanges
			.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
			.subscribe(() => {
				this.pageIndex.set(0);
				this.load();
			});

		this.load();
	}

	onPageChange(event: PageEvent): void {
		this.pageIndex.set(event.pageIndex);
		this.pageSize.set(event.pageSize);
		this.load();
	}

	private load(): void {
		this.loading.set(true);
		const raw = this.filters.getRawValue();

		this.ticketsApi
			.search({
				page: this.pageIndex() + 1,
				pageSize: this.pageSize(),
				search: raw.search?.trim() || undefined,
				status: raw.status ?? undefined,
				priority: raw.priority ?? undefined,
				category: raw.category ?? undefined,
				sortBy: 'openedAt',
				sortDir: 'desc',
			})
			.subscribe({
				next: (page) => {
					this.tickets.set(page.items);
					this.total.set(page.total);
					this.loading.set(false);
				},
				error: () => this.loading.set(false),
			});
	}
}
