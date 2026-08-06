import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@anubis/shared';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Exige une ou plusieurs permissions sur une route. Toutes les permissions
 * listees sont requises.
 *
 *   @RequirePermissions(Permission.SANCTIONS_WRITE)
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
