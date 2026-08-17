import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { debounceTime } from 'rxjs';
import { roleColorToHex, type RoleSummary } from '@anubis/shared';
import { MembersApi } from '../../../core/api/members.api';
import { NotificationService } from '../../../core/notification.service';

/**
 * Reglage de l'historisation des roles.
 *
 * Sur un serveur avec des roles de couleur ou des badges auto-attribues, les
 * mouvements de ces roles representent l'essentiel des evenements et rendent la
 * chronologie d'un membre illisible. Les exclure ici les fait disparaitre des
 * fiches, sans rien supprimer et sans les retirer des filtres.
 */
@Component({
	selector: 'app-roles',
	imports: [
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatProgressBarModule,
		MatSlideToggleModule,
		MatTooltipModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './roles.html',
	styleUrl: './roles.scss',
})
export class RolesPage {
	private readonly membersApi = inject(MembersApi);
	private readonly notifications = inject(NotificationService);

	readonly roleColor = roleColorToHex;

	readonly loading = signal(true);
	readonly roles = signal<RoleSummary[]>([]);
	/** Roles dont le basculement est en cours, pour desactiver leur interrupteur. */
	readonly pending = signal<ReadonlySet<string>>(new Set());

	readonly search = new FormControl('', { nonNullable: true });
	private readonly searchTerm = signal('');

	readonly filteredRoles = computed(() => {
		const term = this.searchTerm().trim().toLowerCase();
		const roles = this.roles();
		if (!term) return roles;
		return roles.filter((role) => role.name.toLowerCase().includes(term));
	});

	readonly trackedCount = computed(() => this.roles().filter((role) => role.trackHistory).length);

	constructor() {
		this.search.valueChanges
			.pipe(debounceTime(200), takeUntilDestroyed())
			.subscribe((value) => this.searchTerm.set(value));

		this.load();
	}

	isPending(roleId: string): boolean {
		return this.pending().has(roleId);
	}

	toggle(role: RoleSummary, trackHistory: boolean): void {
		this.setPending(role.id, true);

		this.membersApi.updateRoleTracking(role.id, { trackHistory }).subscribe({
			next: (updated) => {
				this.roles.update((roles) =>
					roles.map((item) => (item.id === updated.id ? updated : item)),
				);
				this.setPending(role.id, false);
				this.notifications.success(
					trackHistory
						? `Les mouvements de « ${role.name} » sont de nouveau historisés.`
						: `« ${role.name} » n'apparaîtra plus dans les chronologies.`,
				);
			},
			// L'interrupteur reste sur son ancienne valeur puisque la liste n'a
			// pas ete modifiee : l'echec est deja signale par l'intercepteur.
			error: () => this.setPending(role.id, false),
		});
	}

	private setPending(roleId: string, active: boolean): void {
		this.pending.update((current) => {
			const next = new Set(current);
			if (active) next.add(roleId);
			else next.delete(roleId);
			return next;
		});
	}

	private load(): void {
		this.loading.set(true);

		this.membersApi.listRoles().subscribe({
			next: (roles) => {
				this.roles.set(roles);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}
}
