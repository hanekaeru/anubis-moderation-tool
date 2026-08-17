import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Permission, type RaidIncidentDto } from '@anubis/shared';
import { RaidApi } from '../../../core/api/raid.api';
import { NotificationService } from '../../../core/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';

const SNOWFLAKE = /^\d{17,20}$/;

@Component({
	selector: 'app-raid',
	imports: [
		FrDatePipe,
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatProgressBarModule,
		MatSlideToggleModule,
		MatTableModule,
		MatTooltipModule,
		ReactiveFormsModule,
		RelativeTimePipe,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './raid.html',
	styleUrl: './raid.scss',
})
export class RaidPage {
	private readonly raidApi = inject(RaidApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);

	readonly Permission = Permission;
	readonly columns = ['triggeredAt', 'joinCount', 'window', 'status', 'resolvedBy'];

	readonly loading = signal(true);
	readonly saving = signal(false);
	readonly triggering = signal(false);
	readonly resolvingId = signal<string | null>(null);
	readonly incidents = signal<RaidIncidentDto[]>([]);

	readonly activeIncident = computed(() => this.incidents().find((incident) => incident.active) ?? null);

	readonly form = this.formBuilder.nonNullable.group({
		enabled: [false],
		joinThreshold: [10, [Validators.required, Validators.min(2)]],
		windowSeconds: [30, [Validators.required, Validators.min(5)]],
		lockdownMinutes: [15, [Validators.required, Validators.min(1)]],
		alertRoleId: [''],
	});

	constructor() {
		this.load();
	}

	save(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}

		this.saving.set(true);
		const raw = this.form.getRawValue();

		this.raidApi
			.updateConfig({
				enabled: raw.enabled,
				joinThreshold: raw.joinThreshold,
				windowSeconds: raw.windowSeconds,
				lockdownMinutes: raw.lockdownMinutes,
				alertRoleId: SNOWFLAKE.test(raw.alertRoleId) ? raw.alertRoleId : null,
			})
			.subscribe({
				next: () => {
					this.saving.set(false);
					this.notifications.success('Réglages anti-raid mis à jour.');
				},
				error: () => this.saving.set(false),
			});
	}

	triggerLockdown(): void {
		this.triggering.set(true);

		this.raidApi.triggerLockdown().subscribe({
			next: () => {
				this.triggering.set(false);
				this.notifications.success('Confinement déclenché — le bot verrouille les salons.');
				this.loadIncidents();
			},
			error: () => this.triggering.set(false),
		});
	}

	resolve(incident: RaidIncidentDto): void {
		this.resolvingId.set(incident.id);

		this.raidApi.resolve(incident.id).subscribe({
			next: () => {
				this.resolvingId.set(null);
				this.notifications.success('Confinement levé — le bot déverrouille les salons.');
				this.loadIncidents();
			},
			error: () => this.resolvingId.set(null),
		});
	}

	private load(): void {
		this.loading.set(true);

		this.raidApi.getConfig().subscribe({
			next: (config) => {
				this.form.patchValue({
					enabled: config.enabled,
					joinThreshold: config.joinThreshold,
					windowSeconds: config.windowSeconds,
					lockdownMinutes: config.lockdownMinutes,
					alertRoleId: config.alertRoleId ?? '',
				});
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});

		this.loadIncidents();
	}

	private loadIncidents(): void {
		this.raidApi.listIncidents().subscribe({
			next: (incidents) => this.incidents.set(incidents),
		});
	}
}
