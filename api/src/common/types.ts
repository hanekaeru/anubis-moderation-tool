import type { AppUserRole, Permission } from '@anubis/shared';

/** Ce que le guard JWT attache a la requete apres validation du jeton. */
export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: AppUserRole;
  permissions: Permission[];
  mustChangePassword: boolean;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}
