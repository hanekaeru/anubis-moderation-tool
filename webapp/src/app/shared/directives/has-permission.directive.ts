import {
  Directive,
  Input,
  TemplateRef,
  ViewContainerRef,
  inject,
} from '@angular/core';
import type { Permission } from '@anubis/shared';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Masque un fragment de template quand le compte n'a pas la permission.
 *
 *   <button *appHasPermission="Permission.SANCTIONS_WRITE">Sanctionner</button>
 *
 * Purement cosmetique : cacher un bouton n'empeche personne d'appeler l'API.
 * La regle qui compte est celle du serveur, celle-ci evite seulement de
 * proposer une action qui echouerait.
 */
@Directive({ selector: '[appHasPermission]' })
export class HasPermissionDirective {
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly auth = inject(AuthService);

  private rendered = false;

  /** Accepte une permission ou une liste : une seule suffit a afficher. */
  @Input({ required: true })
  set appHasPermission(permissions: Permission | Permission[]) {
    const required = Array.isArray(permissions) ? permissions : [permissions];
    const allowed = this.auth.hasAnyPermission(required);

    if (allowed && !this.rendered) {
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.rendered = true;
    } else if (!allowed && this.rendered) {
      this.viewContainer.clear();
      this.rendered = false;
    }
  }
}
