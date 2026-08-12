import { Routes } from '@angular/router';
import { Permission } from '@anubis/shared';
import { authGuard, guestGuard, permissionGuard } from './core/auth/auth.guard';

/**
 * Toutes les pages sont chargees a la demande.
 *
 * Les URL sont en francais : ce sont elles que l'equipe de moderation se
 * partage, elles doivent se lire sans effort.
 */
export const routes: Routes = [
	{
		path: 'connexion',
		canActivate: [guestGuard],
		loadComponent: () => import('./features/auth/login/login').then((m) => m.LoginPage),
		title: 'Connexion — Anubis',
	},
	{
		path: 'mot-de-passe',
		canActivate: [authGuard],
		loadComponent: () =>
			import('./features/auth/change-password/change-password').then((m) => m.ChangePasswordPage),
		title: 'Changer le mot de passe — Anubis',
	},
	{
		path: '',
		canActivate: [authGuard],
		loadComponent: () => import('./layout/shell/shell').then((m) => m.Shell),
		children: [
			{
				path: '',
				loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.DashboardPage),
				title: "Vue d'ensemble — Anubis",
			},
			{
				path: 'membres',
				canActivate: [permissionGuard(Permission.MEMBERS_READ)],
				loadComponent: () =>
					import('./features/members/member-list/member-list').then((m) => m.MemberListPage),
				title: 'Membres — Anubis',
			},
			{
				path: 'membres/:userId',
				canActivate: [permissionGuard(Permission.MEMBERS_READ)],
				loadComponent: () =>
					import('./features/members/member-detail/member-detail').then((m) => m.MemberDetailPage),
				title: 'Fiche membre — Anubis',
			},
			{
				path: 'sanctions',
				canActivate: [permissionGuard(Permission.SANCTIONS_READ)],
				loadComponent: () =>
					import('./features/moderation/sanction-list/sanction-list').then(
						(m) => m.SanctionListPage,
					),
				title: 'Sanctions — Anubis',
			},
			{
				path: 'avertissements',
				canActivate: [permissionGuard(Permission.WARNINGS_READ)],
				loadComponent: () =>
					import('./features/moderation/warning-list/warning-list').then((m) => m.WarningListPage),
				title: 'Avertissements — Anubis',
			},
			{
				path: 'tickets',
				canActivate: [permissionGuard(Permission.TICKETS_READ)],
				loadComponent: () =>
					import('./features/tickets/ticket-list/ticket-list').then((m) => m.TicketListPage),
				title: 'Tickets — Anubis',
			},
			{
				path: 'tickets/:id',
				canActivate: [permissionGuard(Permission.TICKETS_READ)],
				loadComponent: () =>
					import('./features/tickets/ticket-detail/ticket-detail').then((m) => m.TicketDetailPage),
				title: 'Ticket — Anubis',
			},
			{
				path: 'comptes',
				canActivate: [permissionGuard(Permission.USERS_READ)],
				loadComponent: () =>
					import('./features/admin/app-users/app-users').then((m) => m.AppUsersPage),
				title: 'Comptes du staff — Anubis',
			},
			{
				path: 'roles',
				canActivate: [permissionGuard(Permission.ROLES_MANAGE)],
				loadComponent: () => import('./features/admin/roles/roles').then((m) => m.RolesPage),
				title: 'Roles suivis — Anubis',
			},
			{
				path: 'journal',
				canActivate: [permissionGuard(Permission.AUDIT_READ)],
				loadComponent: () => import('./features/admin/audit/audit').then((m) => m.AuditPage),
				title: "Journal d'activite — Anubis",
			},
			{
				path: 'logs',
				canActivate: [permissionGuard(Permission.LOGS_READ)],
				loadComponent: () => import('./features/admin/logs/logs').then((m) => m.LogsPage),
				title: 'Logs — Anubis',
			},
		],
	},
	{ path: '**', redirectTo: '' },
];
