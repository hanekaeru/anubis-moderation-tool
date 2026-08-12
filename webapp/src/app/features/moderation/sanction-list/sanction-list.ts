import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';
import {
	DEFAULT_PAGE_SIZE,
	Permission,
	SANCTION_TYPE_LABELS,
	SanctionStatus,
	SanctionType,
	type SanctionDto,
} from '@anubis/shared';
import { ModerationApi } from '../../../core/api/moderation.api';
import { NotificationService } from '../../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../../shared/components/confirm-dialog';
import { MemberAvatar } from '../../../shared/components/member-avatar';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { DurationPipe, FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';

const STATUS_LABELS: Record<SanctionStatus, string> = {
	ACTIVE: 'En cours',
	EXPIRED: 'Terminee',
	REVOKED: 'Levee',
};

@Component({
	selector: 'app-sanction-list',
	imports: [
		DurationPipe,
		FrDatePipe,
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
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
	templateUrl: './sanction-list.html',
	styleUrl: './sanction-list.scss',
})
export class SanctionListPage {
	private readonly moderationApi = inject(ModerationApi);
	private readonly dialog = inject(MatDialog);
	private readonly notifications = inject(NotificationService);
	private readonly formBuilder = inject(FormBuilder);

	readonly Permission = Permission;
	// Index en `string` : les lignes de `mat-table` sont typees `any` dans le
	// template, un `Record` sur l'enum serait refuse a la compilation.
	readonly typeLabels: Record<string, string> = SANCTION_TYPE_LABELS;
	readonly statusLabels: Record<string, string> = STATUS_LABELS;
	readonly types = Object.values(SanctionType);
	readonly statuses = Object.values(SanctionStatus);

	readonly columns = ['member', 'type', 'reason', 'duration', 'issuedBy', 'status', 'actions'];

	readonly loading = signal(false);
	readonly sanctions = signal<SanctionDto[]>([]);
	readonly total = signal(0);
	readonly pageIndex = signal(0);
	readonly pageSize = signal(DEFAULT_PAGE_SIZE);

	readonly filters = this.formBuilder.group({
		type: [null as SanctionType | null],
		status: [null as SanctionStatus | null],
	});

	constructor() {
		this.filters.valueChanges.pipe(debounceTime(200), takeUntilDestroyed()).subscribe(() => {
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

	revoke(sanction: SanctionDto): void {
		const data: ConfirmDialogData = {
			title: 'Lever la sanction',
			message: `${this.typeLabels[sanction.type]} visant ${sanction.member.username} : ${sanction.reason}`,
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
						this.load();
					},
				});
			});
	}

	private load(): void {
		this.loading.set(true);
		const raw = this.filters.getRawValue();

		this.moderationApi
			.searchSanctions({
				page: this.pageIndex() + 1,
				pageSize: this.pageSize(),
				type: raw.type ?? undefined,
				status: raw.status ?? undefined,
			})
			.subscribe({
				next: (page) => {
					this.sanctions.set(page.items);
					this.total.set(page.total);
					this.loading.set(false);
				},
				error: () => this.loading.set(false),
			});
	}
}
