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
				path: 'mon-compte/discord',
				loadComponent: () =>
					import('./features/account/discord-link/discord-link').then((m) => m.DiscordLinkPage),
				title: 'Mon compte Discord — Anubis',
			},
			{
				path: 'mon-compte/double-authentification',
				loadComponent: () =>
					import('./features/account/two-factor/two-factor').then((m) => m.TwoFactorPage),
				title: 'Double authentification — Anubis',
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
				path: 'bareme-de-points',
				// Lecture ouverte a qui peut lire les sanctions : le bareme explique
				// les scores affiches sur les fiches. Seul l'enregistrement demande
				// `moderation-points:configure`.
				canActivate: [permissionGuard(Permission.SANCTIONS_READ)],
				loadComponent: () =>
					import('./features/moderation/points/points').then(
						(m) => m.ModerationPointsPage,
					),
				title: 'Barème de points — Anubis',
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
			// Declaree avant `tickets/:id`, qui prendrait sinon « configuration »
			// pour un identifiant de ticket.
			{
				path: 'tickets/configuration',
				canActivate: [permissionGuard(Permission.TICKETS_READ)],
				loadComponent: () =>
					import('./features/tickets/ticket-config/ticket-config').then(
						(m) => m.TicketConfigPage,
					),
				title: 'Configuration des tickets — Anubis',
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
				title: 'Rôles suivis — Anubis',
			},
			{
				path: 'journal',
				canActivate: [permissionGuard(Permission.AUDIT_READ)],
				loadComponent: () => import('./features/admin/audit/audit').then((m) => m.AuditPage),
				title: "Journal d'activité — Anubis",
			},
			{
				path: 'logs',
				canActivate: [permissionGuard(Permission.LOGS_READ)],
				loadComponent: () => import('./features/admin/logs/logs').then((m) => m.LogsPage),
				title: 'Logs — Anubis',
			},
			{
				path: 'esport',
				canActivate: [permissionGuard(Permission.ESPORT_READ)],
				loadComponent: () => import('./features/esport/esport').then((m) => m.EsportPage),
				title: 'Esport — Anubis',
			},
			{
				path: 'arrivees',
				canActivate: [permissionGuard(Permission.LOGS_READ)],
				loadComponent: () => import('./features/welcome/welcome').then((m) => m.WelcomePage),
				title: 'Arrivées & départs — Anubis',
			},
			{
				// Garde sur la permission d'ecriture : la page n'existe que pour
				// changer qui le bot interpelle, il n'y a rien a y consulter.
				path: 'mentions',
				canActivate: [permissionGuard(Permission.LOGS_WRITE)],
				loadComponent: () =>
					import('./features/admin/mentions/mentions').then((m) => m.MentionsPage),
				title: 'Rôles & mentions — Anubis',
			},
			{
				path: 'automod',
				canActivate: [permissionGuard(Permission.AUTOMOD_READ)],
				loadComponent: () =>
					import('./features/security/automod/automod').then((m) => m.AutomodPage),
				title: 'Automodération — Anubis',
			},
			{
				path: 'anti-raid',
				canActivate: [permissionGuard(Permission.RAID_READ)],
				loadComponent: () => import('./features/security/raid/raid').then((m) => m.RaidPage),
				title: 'Anti-raid — Anubis',
			},
			{
				path: 'permissions',
				canActivate: [permissionGuard(Permission.PERMISSIONS_MANAGE)],
				loadComponent: () =>
					import('./features/admin/permissions/permissions').then((m) => m.PermissionsPage),
				title: 'Permissions — Anubis',
			},
			{
				path: 'vocaux',
				canActivate: [permissionGuard(Permission.VOICE_READ)],
				loadComponent: () => import('./features/voice/voice').then((m) => m.VoicePage),
				title: 'Vocaux — Anubis',
			},
			{
				path: 'quarantaine',
				canActivate: [permissionGuard(Permission.QUARANTINE_READ)],
				loadComponent: () =>
					import('./features/security/quarantine/quarantine').then((m) => m.QuarantinePage),
				title: 'Quarantaine — Anubis',
			},
			{
				path: 'statut',
				canActivate: [permissionGuard(Permission.STATUS_READ)],
				loadComponent: () => import('./features/status/status').then((m) => m.StatusPage),
				title: 'Statut — Anubis',
			},
			{
				path: 'wiki',
				canActivate: [permissionGuard(Permission.WIKI_READ)],
				loadComponent: () => import('./features/wiki/wiki-list/wiki-list').then((m) => m.WikiListPage),
				title: 'Wiki de modération — Anubis',
			},
			{
				// Avant `wiki/:slug`, sinon « nouveau » serait lu comme un slug et
				// l'API repondrait 404 au lieu d'ouvrir le formulaire.
				path: 'wiki/nouveau',
				canActivate: [permissionGuard(Permission.WIKI_WRITE)],
				loadComponent: () =>
					import('./features/wiki/wiki-article/wiki-article').then((m) => m.WikiArticlePage),
				data: { creating: true },
				title: 'Nouvel article — Anubis',
			},
			{
				path: 'wiki/:slug',
				canActivate: [permissionGuard(Permission.WIKI_READ)],
				loadComponent: () =>
					import('./features/wiki/wiki-article/wiki-article').then((m) => m.WikiArticlePage),
				title: 'Wiki — Anubis',
			},
			{
				path: 'concours',
				canActivate: [permissionGuard(Permission.GIVEAWAY_READ)],
				loadComponent: () =>
					import('./features/giveaway/giveaway').then((m) => m.GiveawayPage),
				title: 'Concours — Anubis',
			},
			{
				path: 'messages',
				canActivate: [permissionGuard(Permission.EMBEDS_READ)],
				loadComponent: () => import('./features/embeds/embeds').then((m) => m.EmbedsPage),
				title: 'Messages — Anubis',
			},
			{
				path: 'experience',
				canActivate: [permissionGuard(Permission.XP_READ)],
				loadComponent: () => import('./features/xp/xp').then((m) => m.XpPage),
				title: 'Expérience — Anubis',
			},
			{
				path: 'sessions',
				canActivate: [permissionGuard(Permission.SESSIONS_READ)],
				loadComponent: () =>
					import('./features/admin/sessions/sessions').then((m) => m.SessionsPage),
				title: 'Sessions actives — Anubis',
			},
			{
				path: 'comptes-signales',
				canActivate: [permissionGuard(Permission.ACCOUNT_FLAGS_READ)],
				loadComponent: () =>
					import('./features/security/account-flags/account-flags').then(
						(m) => m.AccountFlagsPage,
					),
				title: 'Comptes signalés — Anubis',
			},
		],
	},
	{ path: '**', redirectTo: '' },
];
