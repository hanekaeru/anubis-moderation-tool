import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import {
	ACCOUNT_FLAG_TYPE_LABELS,
	DEFAULT_PAGE_SIZE,
	Permission,
	type AccountFlagDto,
} from '@anubis/shared';
import { AccountFlagsApi } from '../../../core/api/account-flags.api';
import { NotificationService } from '../../../core/notification.service';
import { MemberAvatar } from '../../../shared/components/member-avatar';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RelativeTimePipe } from '../../../shared/pipes/format.pipes';

@Component({
	selector: 'app-account-flags',
	imports: [
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatPaginatorModule,
		MatProgressBarModule,
		MatSelectModule,
		MatTableModule,
		MemberAvatar,
		ReactiveFormsModule,
		RelativeTimePipe,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './account-flags.html',
	styleUrl: './account-flags.scss',
})
export class AccountFlagsPage {
	private readonly accountFlagsApi = inject(AccountFlagsApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);

	readonly Permission = Permission;
	readonly typeLabels: Record<string, string> = ACCOUNT_FLAG_TYPE_LABELS;
	readonly columns = ['member', 'type', 'details', 'createdAt', 'status'];

	readonly loading = signal(false);
	readonly reviewingId = signal<string | null>(null);
	readonly flags = signal<AccountFlagDto[]>([]);
	readonly total = signal(0);
	readonly pageIndex = signal(0);
	readonly pageSize = signal(DEFAULT_PAGE_SIZE);

	readonly filters = this.formBuilder.group({
		reviewed: [null as boolean | null],
	});

	constructor() {
		this.filters.valueChanges
			.pipe(debounceTime(150), distinctUntilChanged(), takeUntilDestroyed())
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

	review(flag: AccountFlagDto): void {
		this.reviewingId.set(flag.id);

		this.accountFlagsApi.review(flag.id).subscribe({
			next: (updated) => {
				this.reviewingId.set(null);
				this.flags.update((flags) => flags.map((f) => (f.id === updated.id ? updated : f)));
				this.notifications.success('Signalement marqué comme traité.');
			},
			error: () => this.reviewingId.set(null),
		});
	}

	/** Rendu compact des details bruts (age du compte, pseudo imite, ...). */
	detailsText(flag: AccountFlagDto): string {
		if (!flag.details) return '—';
		return Object.entries(flag.details)
			.map(([key, value]) => `${key} : ${value}`)
			.join(', ');
	}

	private load(): void {
		this.loading.set(true);
		const reviewed = this.filters.getRawValue().reviewed;

		this.accountFlagsApi
			.search({
				page: this.pageIndex() + 1,
				pageSize: this.pageSize(),
				reviewed: reviewed ?? undefined,
			})
			.subscribe({
				next: (page) => {
					this.flags.set(page.items);
					this.total.set(page.total);
					this.loading.set(false);
				},
				error: () => this.loading.set(false),
			});
	}
}
