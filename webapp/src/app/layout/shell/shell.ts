import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { APP_USER_ROLE_LABELS, Permission } from '@anubis/shared';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeService } from '../../core/theme.service';

interface NavEntry {
  path: string;
  label: string;
  icon: string;
  /** Entree masquee si le compte n'a aucune de ces permissions. */
  permissions: Permission[];
}

const NAV_ENTRIES: NavEntry[] = [
  { path: '/', label: "Vue d'ensemble", icon: 'dashboard', permissions: [Permission.STATS_READ] },
  { path: '/membres', label: 'Membres', icon: 'group', permissions: [Permission.MEMBERS_READ] },
  { path: '/avertissements', label: 'Avertissements', icon: 'flag', permissions: [Permission.WARNINGS_READ] },
  { path: '/sanctions', label: 'Sanctions', icon: 'gavel', permissions: [Permission.SANCTIONS_READ] },
  { path: '/tickets', label: 'Tickets', icon: 'confirmation_number', permissions: [Permission.TICKETS_READ] },
  { path: '/comptes', label: 'Comptes', icon: 'admin_panel_settings', permissions: [Permission.USERS_READ] },
  { path: '/roles', label: 'Roles suivis', icon: 'label', permissions: [Permission.ROLES_MANAGE] },
  { path: '/logs', label: 'Configurations', icon: 'file_copy', permissions: [Permission.LOGS_READ] },
  { path: '/journal', label: "Journal d'activite", icon: 'history', permissions: [Permission.AUDIT_READ] }
];

/** Cadre de l'application : barre laterale, en-tete, zone de contenu. */
@Component({
  selector: 'app-shell',
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatListModule,
    MatMenuModule,
    MatSidenavModule,
    MatToolbarModule,
    MatTooltipModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly auth = inject(AuthService);
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly themeService = inject(ThemeService);

  readonly user = this.auth.currentUser;
  readonly roleLabels = APP_USER_ROLE_LABELS;
  readonly theme = this.themeService.current;

  /** Sur petit ecran, la barre laterale devient un tiroir superpose. */
  readonly isHandset = toSignal(
    this.breakpoints
      .observe([Breakpoints.Handset, Breakpoints.TabletPortrait])
      .pipe(map((result) => result.matches)),
    { initialValue: false },
  );

  readonly drawerOpened = signal(true);

  readonly navigation = computed(() =>
    NAV_ENTRIES.filter((entry) => this.auth.hasAnyPermission(entry.permissions)),
  );

  toggleDrawer(): void {
    this.drawerOpened.update((opened) => !opened);
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  /** Referme le tiroir apres navigation sur mobile, sinon il masque la page. */
  onNavigate(): void {
    if (this.isHandset()) this.drawerOpened.set(false);
  }

  logout(): void {
    this.auth.logout();
  }
}
