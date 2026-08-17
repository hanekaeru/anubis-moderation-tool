import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
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
	WARNING_SEVERITY_LABELS,
	WarningSeverity,
	type WarningDto,
} from '@anubis/shared';
import { ModerationApi } from '../../../core/api/moderation.api';
import { NotificationService } from '../../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../../shared/components/confirm-dialog';
import { MemberAvatar } from '../../../shared/components/member-avatar';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';

@Component({
	selector: 'app-warning-list',
	imports: [
		FrDatePipe,
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatCheckboxModule,
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
	templateUrl: './warning-list.html',
	styleUrl: './warning-list.scss',
})
export class WarningListPage {
	private readonly moderationApi = inject(ModerationApi);
	private readonly dialog = inject(MatDialog);
	private readonly notifications = inject(NotificationService);
	private readonly formBuilder = inject(FormBuilder);

	readonly Permission = Permission;
	// `Record<string, string>` et non `Record<WarningSeverity, string>` : les
	// lignes de `mat-table` arrivent en `any` dans le template, un index typé
	// strictement serait refuse a la compilation.
	readonly severityLabels: Record<string, string> = WARNING_SEVERITY_LABELS;
	readonly severities = Object.values(WarningSeverity);

	readonly columns = ['member', 'severity', 'reason', 'issuedBy', 'status', 'actions'];

	readonly loading = signal(false);
	readonly warnings = signal<WarningDto[]>([]);
	readonly total = signal(0);
	readonly pageIndex = signal(0);
	readonly pageSize = signal(DEFAULT_PAGE_SIZE);

	readonly filters = this.formBuilder.group({
		member: [''],
		severity: [null as WarningSeverity | null],
		activeOnly: [false],
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

	revoke(warning: WarningDto): void {
		const data: ConfirmDialogData = {
			title: "Lever l'avertissement",
			message: `Avertissement visant ${warning.member.username} : ${warning.reason}`,
			confirmLabel: 'Lever',
			reasonLabel: 'Motif de la levée',
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((reason) => {
				if (typeof reason !== 'string') return;

				this.moderationApi.revokeWarning(warning.id, { reason }).subscribe({
					next: () => {
						this.notifications.success('Avertissement levé.');
						this.load();
					},
				});
			});
	}

	private load(): void {
		this.loading.set(true);
		const raw = this.filters.getRawValue();

		this.moderationApi
			.searchWarnings({
				page: this.pageIndex() + 1,
				pageSize: this.pageSize(),
				// Chaine vide = pas de filtre, plutot qu'un parametre vide dans
				// chaque URL.
				member: raw.member?.trim() || undefined,
				severity: raw.severity ?? undefined,
				// `false` n'est pas un filtre : ne pas l'envoyer evite de demander
				// explicitement les avertissements inactifs.
				activeOnly: raw.activeOnly ? true : undefined,
			})
			.subscribe({
				next: (page) => {
					this.warnings.set(page.items);
					this.total.set(page.total);
					this.loading.set(false);
				},
				error: () => this.loading.set(false),
			});
	}
}
