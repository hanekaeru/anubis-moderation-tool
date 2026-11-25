import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { APP_USER_ROLE_LABELS, Permission } from '@anubis/shared';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeService } from '../../core/theme.service';
import { Notepad } from '../notepad/notepad';

interface NavEntry {
  path: string;
  label: string;
  icon: string;
  /**
   * Entree masquee si le compte n'a aucune de ces permissions. Vide : ouverte a
   * tout compte (« A traiter », dont chaque section verifie sa propre permission).
   */
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
      { path: '/a-traiter', label: 'À traiter', icon: 'inbox', permissions: [] },
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
      {
        path: '/tickets/configuration',
        label: 'Configuration des tickets',
        icon: 'tune',
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
      {
        path: '/owdle',
        label: 'OWdle',
        icon: 'quiz',
        permissions: [Permission.OWDLE_READ],
      },
      {
        path: '/mini-jeux',
        label: 'Mini-jeux',
        icon: 'event',
        permissions: [Permission.MINIGAMES_READ],
      },
      {
        path: '/esport',
        label: 'Esport',
        icon: 'sports_esports',
        permissions: [Permission.ESPORT_READ],
      },
      {
        path: '/arrivees',
        label: 'Arrivées & départs',
        icon: 'waving_hand',
        permissions: [Permission.LOGS_READ],
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
        path: '/mentions',
        label: 'Rôles & mentions',
        icon: 'alternate_email',
        permissions: [Permission.LOGS_WRITE],
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

/** Largeurs de la barre laterale, en pixels. */
const NAV_MIN = 200;
const NAV_MAX = 360;
const NAV_DEFAULT = 248;
const NAV_COLLAPSED = 72;
/** Tiree en dessous, la barre se replie au lieu d'ecraser ses libelles. */
const NAV_SNAP = 150;
const NAV_STEP = 16;

const STORAGE_WIDTH = 'anubis-nav-width';
const STORAGE_COLLAPSED = 'anubis-nav-collapsed';

/**
 * Preference de confort, propre a ce navigateur : rien de grave si le
 * stockage est indisponible (navigation privee, donnees bloquees), la barre
 * reprend alors sa largeur par defaut.
 */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* preference perdue, sans consequence */
  }
}

const clampWidth = (width: number) => Math.round(Math.min(NAV_MAX, Math.max(NAV_MIN, width)));

/**
 * Cadre de l'application : barre laterale, en-tete, zone de contenu.
 *
 * Sur ordinateur, la barre est une colonne de grille et non un `mat-sidenav` :
 * le conteneur de Material calcule la marge du contenu une fois pour toutes, et
 * ne suit ni une largeur qu'on glisse ni une transition de repli. Une colonne
 * de grille fait les deux sans calcul. Le document defile lui-meme — ce qui
 * rend aussi son effet a `scrollPositionRestoration: 'top'`, sans prise tant
 * que le contenu defilait dans `mat-sidenav-content`.
 *
 * Sur telephone, le tiroir superpose de Material reste le bon outil.
 */
@Component({
  selector: 'app-shell',
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatSidenavModule,
    MatToolbarModule,
    MatTooltipModule,
    NgTemplateOutlet,
    Notepad,
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

  readonly drawerOpened = signal(false);

  readonly year = new Date().getFullYear();

  readonly minWidth = NAV_MIN;
  readonly maxWidth = NAV_MAX;
  /** Largeur deployee, retenue meme repliee pour y revenir. */
  readonly width = signal(clampWidth(Number(readStored(STORAGE_WIDTH)) || NAV_DEFAULT));
  readonly collapsed = signal(readStored(STORAGE_COLLAPSED) === 'true');
  readonly resizing = signal(false);
  readonly navWidth = computed(() => (this.collapsed() ? NAV_COLLAPSED : this.width()));

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
      entries: section.entries.filter(
        (entry) => entry.permissions.length === 0 || this.auth.hasAnyPermission(entry.permissions),
      ),
    })).filter((section) => section.entries.length > 0),
  );

  toggleDrawer(): void {
    this.drawerOpened.update((opened) => !opened);
  }

  toggleCollapsed(): void {
    this.setCollapsed(!this.collapsed());
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed.set(collapsed);
    writeStored(STORAGE_COLLAPSED, String(collapsed));
  }

  private setWidth(width: number): void {
    this.width.set(clampWidth(width));
    writeStored(STORAGE_WIDTH, String(this.width()));
  }

  /**
   * Glisser la poignee. La barre part du bord gauche de la fenetre : la
   * largeur voulue est donc l'abscisse du pointeur, sans calcul de delta.
   * La capture du pointeur garde le glissement meme quand il sort de la poignee.
   */
  startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    this.resizing.set(true);

    const move = (e: PointerEvent) => {
      if (e.clientX < NAV_SNAP) {
        if (!this.collapsed()) this.collapsed.set(true);
        return;
      }
      this.collapsed.set(false);
      this.width.set(clampWidth(e.clientX));
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      this.resizing.set(false);
      this.setCollapsed(this.collapsed());
      this.setWidth(this.width());
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  resetWidth(): void {
    this.setCollapsed(false);
    this.setWidth(NAV_DEFAULT);
  }

  /** Fleches : elargir ou retrecir par pas ; Entree : replier ou deplier. */
  onHandleKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowLeft':
        if (this.collapsed()) break;
        if (this.width() - NAV_STEP < NAV_MIN) this.setCollapsed(true);
        else this.setWidth(this.width() - NAV_STEP);
        break;
      case 'ArrowRight':
        if (this.collapsed()) this.setCollapsed(false);
        else this.setWidth(this.width() + NAV_STEP);
        break;
      case 'Enter':
      case ' ':
        this.toggleCollapsed();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  scrollToTop(): void {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
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
