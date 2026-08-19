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
import { RouterLink } from '@angular/router';
import {
	DEFAULT_QUARANTINE_BATTLENET_BUTTON_LABEL,
	DEFAULT_QUARANTINE_BUTTON_LABEL,
	MAX_QUARANTINE_RELEASE_ROLES,
	Permission,
	type QuarantineStatusDto,
} from '@anubis/shared';
import { QuarantineApi } from '../../../core/api/quarantine.api';
import { NotificationService } from '../../../core/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';

const SNOWFLAKE = /^\d{17,20}$/;

@Component({
	selector: 'app-quarantine',
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
		RouterLink,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './quarantine.html',
	styleUrl: './quarantine.scss',
})
export class QuarantinePage {
	private readonly quarantineApi = inject(QuarantineApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);

	readonly Permission = Permission;
	readonly maxReleaseRoles = MAX_QUARANTINE_RELEASE_ROLES;
	readonly columns = ['member', 'quarantinedAt', 'status', 'battlenet', 'actions'];

	readonly loading = signal(true);
	readonly saving = signal(false);
	readonly releasingId = signal<string | null>(null);
	readonly members = signal<QuarantineStatusDto[]>([]);

	/** Etat enregistre, pas celui du formulaire : c'est lui qui decrit ce que fait le bot. */
	private readonly saved = signal<{
		enabled: boolean;
		roleId: string | null;
		battlenetRequired: boolean;
		battlenetAvailable: boolean;
	}>({
		enabled: false,
		roleId: null,
		battlenetRequired: false,
		battlenetAvailable: false,
	});

	readonly enabled = computed(() => this.saved().enabled);
	readonly battlenetRequired = computed(() => this.saved().battlenetRequired);

	/** Le role est ce qui bloque reellement : active sans lui, la quarantaine ne fait rien. */
	readonly misconfigured = computed(() => this.saved().enabled && !this.saved().roleId);

	/**
	 * Verification exigee alors que l'API n'a pas de client Blizzard.
	 *
	 * C'est la panne la plus couteuse du dispositif : les arrivants acceptent le
	 * reglement puis restent bloques sur une etape qui ne peut pas aboutir, sans
	 * que rien ne le signale nulle part ailleurs.
	 */
	readonly battlenetUnavailable = computed(
		() => this.saved().battlenetRequired && !this.saved().battlenetAvailable,
	);

	readonly form = this.formBuilder.nonNullable.group({
		enabled: [false],
		roleId: [''],
		channelId: [''],
		message: [''],
		buttonLabel: [
			DEFAULT_QUARANTINE_BUTTON_LABEL,
			[Validators.required, Validators.maxLength(80)],
		],
		releaseAddRoleIds: [''],
		releaseRemoveRoleIds: [''],
		acceptAddRoleIds: [''],
		acceptRemoveRoleIds: [''],
		verifyAddRoleIds: [''],
		verifyRemoveRoleIds: [''],
		battlenetRequired: [false],
		battlenetButtonLabel: [
			DEFAULT_QUARANTINE_BATTLENET_BUTTON_LABEL,
			[Validators.required, Validators.maxLength(80)],
		],
		battlenetMessage: [''],
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

		this.quarantineApi
			.updateConfig({
				enabled: raw.enabled,
				roleId: SNOWFLAKE.test(raw.roleId) ? raw.roleId : null,
				channelId: SNOWFLAKE.test(raw.channelId) ? raw.channelId : null,
				message: raw.message.trim() ? raw.message.trim() : null,
				buttonLabel: raw.buttonLabel,
				releaseAddRoleIds: this.splitIds(raw.releaseAddRoleIds),
				releaseRemoveRoleIds: this.splitIds(raw.releaseRemoveRoleIds),
				acceptAddRoleIds: this.splitIds(raw.acceptAddRoleIds),
				acceptRemoveRoleIds: this.splitIds(raw.acceptRemoveRoleIds),
				verifyAddRoleIds: this.splitIds(raw.verifyAddRoleIds),
				verifyRemoveRoleIds: this.splitIds(raw.verifyRemoveRoleIds),
				battlenetRequired: raw.battlenetRequired,
				battlenetButtonLabel: raw.battlenetButtonLabel,
				battlenetMessage: raw.battlenetMessage.trim()
					? raw.battlenetMessage.trim()
					: null,
			})
			.subscribe({
				next: (config) => {
					this.saving.set(false);
					this.saved.set({
						enabled: config.enabled,
						roleId: config.roleId,
						battlenetRequired: config.battlenetRequired,
						battlenetAvailable: config.battlenetAvailable,
					});
					this.notifications.success(
						'Réglages de quarantaine mis à jour. Rejoue /quarantaine-message pour republier le panneau.',
					);
				},
				error: () => this.saving.set(false),
			});
	}

	release(member: QuarantineStatusDto): void {
		this.releasingId.set(member.userId);

		this.quarantineApi.release(member.userId).subscribe({
			next: () => {
				this.releasingId.set(null);
				this.notifications.success('Quarantaine levée — le bot retire le rôle.');
				this.loadMembers();
			},
			error: () => this.releasingId.set(null),
		});
	}

	/** Ce que la colonne « Battle.net » affiche pour une ligne donnee. */
	etatBattlenet(member: QuarantineStatusDto): string {
		if (!member.battlenetVerifiedAt) return 'Non vérifié';
		// `battletag` est `null` sans la permission : l'etape reste lisible, pas
		// l'identite Blizzard.
		return member.battletag ?? 'Vérifié';
	}

	/**
	 * Identifiants saisis en texte libre, comme les roles dispenses de l'automod.
	 *
	 * Ce qui n'est pas un snowflake est ecarte en silence : le champ tolere ainsi
	 * un separateur en trop ou une liste collee avec des espaces, plutot que de
	 * refuser l'enregistrement entier pour une virgule finale.
	 */
	private splitIds(value: string): string[] {
		const ids = value
			.split(',')
			.map((id) => id.trim())
			.filter((id) => SNOWFLAKE.test(id));

		// Doublons retires : l'API borne le nombre d'entrees, et deux fois le
		// meme role consommerait une place pour rien.
		return [...new Set(ids)].slice(0, MAX_QUARANTINE_RELEASE_ROLES);
	}

	private load(): void {
		this.loading.set(true);

		this.quarantineApi.getConfig().subscribe({
			next: (config) => {
				this.form.patchValue({
					enabled: config.enabled,
					roleId: config.roleId ?? '',
					channelId: config.channelId ?? '',
					message: config.message ?? '',
					buttonLabel: config.buttonLabel,
					releaseAddRoleIds: config.releaseAddRoleIds.join(', '),
					releaseRemoveRoleIds: config.releaseRemoveRoleIds.join(', '),
					acceptAddRoleIds: config.acceptAddRoleIds.join(', '),
					acceptRemoveRoleIds: config.acceptRemoveRoleIds.join(', '),
					verifyAddRoleIds: config.verifyAddRoleIds.join(', '),
					verifyRemoveRoleIds: config.verifyRemoveRoleIds.join(', '),
					battlenetRequired: config.battlenetRequired,
					battlenetButtonLabel: config.battlenetButtonLabel,
					battlenetMessage: config.battlenetMessage ?? '',
				});
				this.saved.set({
					enabled: config.enabled,
					roleId: config.roleId,
					battlenetRequired: config.battlenetRequired,
					battlenetAvailable: config.battlenetAvailable,
				});
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});

		this.loadMembers();
	}

	private loadMembers(): void {
		this.quarantineApi.listActive().subscribe({
			next: (members) => this.members.set(members),
		});
	}
}
