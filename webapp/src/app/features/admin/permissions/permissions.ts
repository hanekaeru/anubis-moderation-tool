import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
	APP_USER_ROLE_LABELS,
	PERMISSION_GROUPS,
	PERMISSION_LABELS,
	type AppUserRole,
	type Permission,
	type RolePermissionsDto,
} from '@anubis/shared';
import { RolePermissionsApi } from '../../../core/api/role-permissions.api';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/notification.service';

@Component({
	selector: 'app-permissions',
	imports: [
		MatButtonModule,
		MatCardModule,
		MatCheckboxModule,
		MatIconModule,
		MatProgressBarModule,
		MatTabsModule,
		MatTooltipModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './permissions.html',
	styleUrl: './permissions.scss',
})
export class PermissionsPage {
	private readonly api = inject(RolePermissionsApi);
	private readonly auth = inject(AuthService);
	private readonly notifications = inject(NotificationService);

	readonly groups = PERMISSION_GROUPS;
	readonly permissionLabels = PERMISSION_LABELS;
	readonly roleLabels = APP_USER_ROLE_LABELS;

	readonly loading = signal(true);
	readonly saving = signal(false);
	readonly roles = signal<RolePermissionsDto[]>([]);
	readonly selectedRole = signal<AppUserRole>('VIEWER');

	/** Etat coche du formulaire, indexe par role : le brouillon avant envoi. */
	private readonly draft = signal<Record<string, Set<Permission>>>({});

	readonly current = computed(
		() => this.roles().find((row) => row.role === this.selectedRole()) ?? null,
	);

	readonly selectedDraft = computed(
		() => this.draft()[this.selectedRole()] ?? new Set<Permission>(),
	);

	/** Le brouillon s'ecarte-t-il de ce qui est enregistre ? */
	readonly dirty = computed(() => {
		const role = this.current();
		if (!role) return false;

		const brouillon = this.selectedDraft();
		return (
			brouillon.size !== role.permissions.length ||
			role.permissions.some((permission) => !brouillon.has(permission))
		);
	});

	/** Le brouillon s'ecarte-t-il de la matrice livree avec le code ? */
	readonly customised = computed(() => {
		const role = this.current();
		if (!role) return false;

		const brouillon = this.selectedDraft();
		return (
			brouillon.size !== role.defaults.length ||
			role.defaults.some((permission) => !brouillon.has(permission))
		);
	});

	constructor() {
		this.load();
	}

	selectRole(role: AppUserRole): void {
		this.selectedRole.set(role);
	}

	isChecked(permission: Permission): boolean {
		return this.selectedDraft().has(permission);
	}

	isDefault(permission: Permission): boolean {
		return this.current()?.defaults.includes(permission) ?? false;
	}

	toggle(permission: Permission, checked: boolean): void {
		const role = this.selectedRole();

		this.draft.update((draft) => {
			const suivant = new Set(draft[role] ?? []);
			if (checked) suivant.add(permission);
			else suivant.delete(permission);
			return { ...draft, [role]: suivant };
		});
	}

	/** Recoche exactement la matrice du code, sans enregistrer. */
	resetToDefaults(): void {
		const role = this.current();
		if (!role) return;

		this.draft.update((draft) => ({
			...draft,
			[role.role]: new Set(role.defaults),
		}));
	}

	cancel(): void {
		const role = this.current();
		if (!role) return;

		this.draft.update((draft) => ({
			...draft,
			[role.role]: new Set(role.permissions),
		}));
	}

	save(): void {
		const role = this.current();
		if (!role || role.locked) return;

		this.saving.set(true);
		const permissions = [...this.selectedDraft()];

		this.api.updateRole(role.role, { permissions }).subscribe({
			next: (updated) => {
				this.saving.set(false);
				this.roles.update((roles) =>
					roles.map((row) => (row.role === updated.role ? updated : row)),
				);
				this.notifications.success(
					`Permissions du rôle « ${this.roleLabels[updated.role]} » enregistrées.`,
				);

				// Le compte connecté peut porter ce rôle : sans relecture, le menu
				// et les boutons resteraient sur les droits d'avant.
				this.auth.refreshMe().subscribe();
			},
			error: () => this.saving.set(false),
		});
	}

	private load(): void {
		this.loading.set(true);

		this.api.getMatrix().subscribe({
			next: (matrix) => {
				this.roles.set(matrix.roles);
				this.draft.set(
					Object.fromEntries(
						matrix.roles.map((row) => [row.role, new Set(row.permissions)]),
					),
				);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}
}
