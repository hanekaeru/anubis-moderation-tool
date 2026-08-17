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

/**
 * Section de la barre laterale.
 *
 * Le titre est un separateur, pas une entree : il ne mene nulle part et ne
 * porte aucune permission propre. Une section entierement masquee par les
 * permissions du compte disparait avec son titre — un intitule seul, sans rien
 * dessous, indiquerait a un compte en lecture seule tout ce qu'il n'a pas le
 * droit de voir.
 */
interface NavSection {
  label: string;
  entries: NavEntry[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Pilotage',
    entries: [
      {
        path: '/',
        label: "Vue d'ensemble",
        icon: 'dashboard',
        permissions: [Permission.STATS_READ],
      },
      {
        path: '/statut',
        label: 'Statut',
        icon: 'monitor_heart',
        permissions: [Permission.STATUS_READ],
      },
    ],
  },
  {
    label: 'Modération',
    entries: [
      { path: '/membres', label: 'Membres', icon: 'group', permissions: [Permission.MEMBERS_READ] },
      {
        path: '/avertissements',
        label: 'Avertissements',
        icon: 'flag',
        permissions: [Permission.WARNINGS_READ],
      },
      {
        path: '/sanctions',
        label: 'Sanctions',
        icon: 'gavel',
        permissions: [Permission.SANCTIONS_READ],
      },
      // Juste apres les deux listes qu'il pondere : le bareme se consulte pour
      // comprendre un score, pas seulement pour le regler.
      {
        path: '/bareme-de-points',
        label: 'Barème de points',
        icon: 'scale',
        permissions: [Permission.SANCTIONS_READ],
      },
      {
        path: '/tickets',
        label: 'Tickets',
        icon: 'confirmation_number',
        permissions: [Permission.TICKETS_READ],
      },
      // A la suite du bloc moderation : c'est une reference qu'on ouvre en
      // traitant un cas, pas un reglage qu'on visite une fois par mois.
      {
        path: '/wiki',
        label: 'Wiki',
        icon: 'menu_book',
        permissions: [Permission.WIKI_READ],
      },
    ],
  },
  {
    label: 'Sécurité',
    entries: [
      {
        path: '/automod',
        label: 'Automodération',
        icon: 'shield',
        permissions: [Permission.AUTOMOD_READ],
      },
      {
        path: '/anti-raid',
        label: 'Anti-raid',
        icon: 'security',
        permissions: [Permission.RAID_READ],
      },
      {
        path: '/quarantaine',
        label: 'Quarantaine',
        icon: 'lock_person',
        permissions: [Permission.QUARANTINE_READ],
      },
      {
        path: '/comptes-signales',
        label: 'Comptes signalés',
        icon: 'person_search',
        permissions: [Permission.ACCOUNT_FLAGS_READ],
      },
    ],
  },
  {
    label: 'Animation',
    entries: [
      {
        path: '/concours',
        label: 'Concours',
        icon: 'celebration',
        permissions: [Permission.GIVEAWAY_READ],
      },
      {
        path: '/vocaux',
        label: 'Vocaux',
        icon: 'volume_up',
        permissions: [Permission.VOICE_READ],
      },
      {
        path: '/messages',
        label: 'Messages',
        icon: 'campaign',
        permissions: [Permission.EMBEDS_READ],
      },
      {
        path: '/experience',
        label: 'Expérience',
        icon: 'trending_up',
        permissions: [Permission.XP_READ],
      },
    ],
  },
  {
    label: 'Administration',
    entries: [
      {
        path: '/comptes',
        label: 'Comptes',
        icon: 'admin_panel_settings',
        permissions: [Permission.USERS_READ],
      },
      {
        path: '/roles',
        label: 'Rôles suivis',
        icon: 'label',
        permissions: [Permission.ROLES_MANAGE],
      },
      {
        path: '/permissions',
        label: 'Permissions',
        icon: 'key',
        permissions: [Permission.PERMISSIONS_MANAGE],
      },
      {
        path: '/sessions',
        label: 'Sessions actives',
        icon: 'devices',
        permissions: [Permission.SESSIONS_READ],
      },
      {
        path: '/logs',
        label: 'Configurations',
        icon: 'file_copy',
        permissions: [Permission.LOGS_READ],
      },
      {
        path: '/journal',
        label: "Journal d'activité",
        icon: 'history',
        permissions: [Permission.AUDIT_READ],
      },
    ],
  },
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

  /**
   * Sections filtrees par les permissions du compte.
   *
   * Le filtre porte sur les entrees d'abord, puis retire les sections vides :
   * un titre sans entree en dessous serait un separateur orphelin, et
   * renseignerait sur des pages inaccessibles.
   */
  readonly navigation = computed(() =>
    NAV_SECTIONS.map((section) => ({
      label: section.label,
      entries: section.entries.filter((entry) => this.auth.hasAnyPermission(entry.permissions)),
    })).filter((section) => section.entries.length > 0),
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
