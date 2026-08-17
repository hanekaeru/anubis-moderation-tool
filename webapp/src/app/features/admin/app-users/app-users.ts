import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
	APP_USER_ROLE_LABELS,
	AppUserRole,
	DEFAULT_PAGE_SIZE,
	Permission,
	type AppUserDto,
} from '@anubis/shared';
import { AppUsersApi } from '../../../core/api/app-users.api';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../../shared/components/confirm-dialog';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { FrDatePipe, RelativeTimePipe } from '../../../shared/pipes/format.pipes';
import { AppUserDialog } from './app-user-dialog';

@Component({
	selector: 'app-app-users',
	imports: [
		FrDatePipe,
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatIconModule,
		MatMenuModule,
		MatPaginatorModule,
		MatProgressBarModule,
		MatSelectModule,
		MatSlideToggleModule,
		MatTableModule,
		MatTooltipModule,
		RelativeTimePipe,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './app-users.html',
	styleUrl: './app-users.scss',
})
export class AppUsersPage {
	private readonly appUsersApi = inject(AppUsersApi);
	private readonly auth = inject(AuthService);
	private readonly dialog = inject(MatDialog);
	private readonly notifications = inject(NotificationService);

	readonly Permission = Permission;
	// Index en `string` : les lignes de `mat-table` sont typees `any` dans le
	// template, un `Record` sur l'enum serait refuse a la compilation.
	readonly roleLabels: Record<string, string> = APP_USER_ROLE_LABELS;
	readonly roles = Object.values(AppUserRole);

	readonly columns = ['username', 'role', 'status', 'lastLogin', 'createdBy', 'actions'];

	readonly loading = signal(false);
	readonly users = signal<AppUserDto[]>([]);
	readonly total = signal(0);
	readonly pageIndex = signal(0);
	readonly pageSize = signal(DEFAULT_PAGE_SIZE);

	readonly currentUserId = this.auth.currentUser()?.id ?? null;

	constructor() {
		this.load();
	}

	onPageChange(event: PageEvent): void {
		this.pageIndex.set(event.pageIndex);
		this.pageSize.set(event.pageSize);
		this.load();
	}

	openCreateDialog(): void {
		this.dialog
			.open(AppUserDialog)
			.afterClosed()
			.subscribe((created) => {
				if (created) this.load();
			});
	}

	changeRole(user: AppUserDto, role: AppUserRole): void {
		if (role === user.role) return;

		this.appUsersApi.update(user.id, { role }).subscribe({
			next: () => {
				this.notifications.success(`Role de ${user.username} mis à jour.`);
				this.load();
			},
			// En cas de refus, on recharge pour que le selecteur revienne a l'etat
			// reel plutot que d'afficher un role qui n'a pas ete applique.
			error: () => this.load(),
		});
	}

	toggleActive(user: AppUserDto): void {
		const activating = !user.isActive;

		const data: ConfirmDialogData = {
			title: activating ? 'Réactiver le compte' : 'Désactiver le compte',
			message: activating
				? `${user.displayName} pourra de nouveau se connecter.`
				: `${user.displayName} sera immédiatement deconnecte et ne pourra plus se connecter.`,
			confirmLabel: activating ? 'Reactiver' : 'Desactiver',
			destructive: !activating,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.appUsersApi.update(user.id, { isActive: activating }).subscribe({
					next: () => {
						this.notifications.success('Compte mis à jour.');
						this.load();
					},
				});
			});
	}

	resetPassword(user: AppUserDto): void {
		const data: ConfirmDialogData = {
			title: 'Réinitialiser le mot de passe',
			message: `Un nouveau mot de passe provisoire sera généré pour ${user.displayName}, et toutes ses sessions seront fermées.`,
			confirmLabel: 'Reinitialiser',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.appUsersApi.resetPassword(user.id).subscribe({
					next: (response) => {
						// Affiche le mot de passe une seule fois, dans une boite qui ne se
						// ferme pas toute seule.
						this.dialog.open(ConfirmDialog, {
							data: {
								title: 'Mot de passe provisoire',
								message: `${response.generatedPassword}\n\nNotez-le maintenant : il ne sera plus affiche.`,
								confirmLabel: 'J ai note',
							} satisfies ConfirmDialogData,
						});
						this.load();
					},
				});
			});
	}

	unlock(user: AppUserDto): void {
		this.appUsersApi.unlock(user.id).subscribe({
			next: () => {
				this.notifications.success('Compte déverrouillé.');
				this.load();
			},
		});
	}

	/**
	 * Retire la double authentification d'un compte.
	 *
	 * C'est la seule issue quand un telephone est perdu **et** les codes de
	 * secours avec : il n'existe aucune recuperation par courriel. L'action
	 * abaisse la protection du compte, elle demande donc une confirmation
	 * explicite.
	 */
	resetTwoFactor(user: AppUserDto): void {
		const data: ConfirmDialogData = {
			title: 'Réinitialiser la double authentification',
			message: `${user.displayName} pourra se connecter avec son seul mot de passe, et devra reconfigurer une application d'authentification. Toutes ses sessions seront fermées.`,
			confirmLabel: 'Reinitialiser',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.appUsersApi.resetTwoFactor(user.id).subscribe({
					next: () => {
						this.notifications.success('Double authentification réinitialisée.');
						this.load();
					},
				});
			});
	}

	isLocked(user: AppUserDto): boolean {
		return user.lockedUntil !== null && new Date(user.lockedUntil) > new Date();
	}

	private load(): void {
		this.loading.set(true);

		this.appUsersApi.search({ page: this.pageIndex() + 1, pageSize: this.pageSize() }).subscribe({
			next: (page) => {
				this.users.set(page.items);
				this.total.set(page.total);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}
}
