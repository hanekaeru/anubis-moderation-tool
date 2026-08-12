import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSort, MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import {
	DEFAULT_PAGE_SIZE,
	MEMBER_STATUS_LABELS,
	MemberStatus,
	roleColorToHex,
	type MemberListItem,
	type MemberSearchQuery,
	type MemberSortField,
	type RoleSummary,
} from '@anubis/shared';
import { MembersApi } from '../../../core/api/members.api';
import { MemberAvatar } from '../../../shared/components/member-avatar';
import { FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';

@Component({
	selector: 'app-member-list',
	imports: [
		FrDatePipe,
		MatButtonModule,
		MatCardModule,
		MatChipsModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatPaginatorModule,
		MatProgressBarModule,
		MatSelectModule,
		MatSortModule,
		MatTableModule,
		MatTooltipModule,
		MemberAvatar,
		ReactiveFormsModule,
		RelativeTimePipe,
		RouterLink,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './member-list.html',
	styleUrl: './member-list.scss',
})
export class MemberListPage {
	private readonly membersApi = inject(MembersApi);
	private readonly formBuilder = inject(FormBuilder);

	readonly statusLabels = MEMBER_STATUS_LABELS;
	readonly statuses = Object.values(MemberStatus);
	readonly roleColor = roleColorToHex;

	readonly columns = [
		'member',
		'roles',
		'joinedAt',
		'warningCount',
		'messageCount30d',
		'lastActiveAt',
		'actions',
	];

	readonly loading = signal(false);
	readonly members = signal<MemberListItem[]>([]);
	readonly roles = signal<RoleSummary[]>([]);
	readonly total = signal(0);
	readonly pageIndex = signal(0);
	readonly pageSize = signal(DEFAULT_PAGE_SIZE);

	private sortBy: MemberSortField = 'username';
	private sortDir: 'asc' | 'desc' = 'asc';

	readonly filters = this.formBuilder.group({
		search: [''],
		status: [null as MemberStatus | null],
		roleId: [null as string | null],
		hasActiveSanction: [null as boolean | null],
	});

	constructor() {
		this.membersApi.listRoles().subscribe({
			next: (roles) => this.roles.set(roles),
			error: () => this.roles.set([]),
		});

		// La recherche part apres une pause de frappe : sans ce delai, chaque
		// caractere declencherait une requete et l'ordre des reponses ne serait
		// plus garanti.
		this.filters.valueChanges
			.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
			.subscribe(() => {
				this.pageIndex.set(0);
				this.load();
			});

		this.load();
	}

	onSortChange(sort: Sort): void {
		this.sortBy = (sort.active as MemberSortField) ?? 'username';
		this.sortDir = sort.direction === 'desc' ? 'desc' : 'asc';
		this.load();
	}

	onPageChange(event: PageEvent): void {
		this.pageIndex.set(event.pageIndex);
		this.pageSize.set(event.pageSize);
		this.load();
	}

	resetFilters(): void {
		this.filters.reset({
			search: '',
			status: null,
			roleId: null,
			hasActiveSanction: null,
		});
	}

	private load(): void {
		this.loading.set(true);

		const raw = this.filters.getRawValue();
		const query: MemberSearchQuery = {
			page: this.pageIndex() + 1,
			pageSize: this.pageSize(),
			sortBy: this.sortBy,
			sortDir: this.sortDir,
			search: raw.search?.trim() || undefined,
			status: raw.status ?? undefined,
			roleId: raw.roleId ?? undefined,
			hasActiveSanction: raw.hasActiveSanction ?? undefined,
		};

		this.membersApi.search(query).subscribe({
			next: (page) => {
				this.members.set(page.items);
				this.total.set(page.total);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}
}
