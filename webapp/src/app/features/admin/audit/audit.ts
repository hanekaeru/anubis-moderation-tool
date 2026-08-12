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
import { debounceTime, distinctUntilChanged } from 'rxjs';
import {
	AUDIT_ACTION_GROUPS,
	AUDIT_ACTION_LABELS,
	DEFAULT_PAGE_SIZE,
	type AuditLogEntryDto,
} from '@anubis/shared';
import { AuditApi } from '../../../core/api/audit.api';
import { FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';

/**
 * Journal des actions effectuees depuis le dashboard.
 *
 * En lecture seule, sans exception : un journal que l'on peut modifier ou
 * effacer depuis l'interface qu'il surveille ne prouve plus rien.
 */
@Component({
	selector: 'app-audit',
	imports: [
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
		ReactiveFormsModule,
		RelativeTimePipe,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './audit.html',
	styleUrl: './audit.scss',
})
export class AuditPage {
	private readonly auditApi = inject(AuditApi);
	private readonly formBuilder = inject(FormBuilder);

	readonly groups = AUDIT_ACTION_GROUPS;
	// Index en `string` : les lignes de `mat-table` arrivent typees `any` dans le
	// template, un `Record` sur une union serait refuse a la compilation.
	readonly actionLabels: Record<string, string> = AUDIT_ACTION_LABELS;

	readonly columns = ['createdAt', 'actor', 'action', 'entity', 'ip'];

	readonly loading = signal(false);
	readonly entries = signal<AuditLogEntryDto[]>([]);
	readonly total = signal(0);
	readonly pageIndex = signal(0);
	readonly pageSize = signal(DEFAULT_PAGE_SIZE);

	readonly filters = this.formBuilder.group({
		action: [''],
	});

	constructor() {
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

	/** Le verbe technique reste affiche quand aucun libelle ne le couvre. */
	label(action: string): string {
		return this.actionLabels[action] ?? action;
	}

	private load(): void {
		this.loading.set(true);
		const raw = this.filters.getRawValue();

		this.auditApi
			.search({
				page: this.pageIndex() + 1,
				pageSize: this.pageSize(),
				action: raw.action?.trim() || undefined,
			})
			.subscribe({
				next: (page) => {
					this.entries.set(page.items);
					this.total.set(page.total);
					this.loading.set(false);
				},
				error: () => this.loading.set(false),
			});
	}
}
