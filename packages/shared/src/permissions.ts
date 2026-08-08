import { AppUserRole } from './enums';

/**
 * Les droits sont exprimes en permissions fines, pas en roles. L'API et le
 * dashboard verifient une permission ; le role ne fait que la distribuer.
 * Ajouter une fonctionnalite = ajouter une permission ici, pas un `if` sur le
 * role dissemine dans le code.
 */
export const Permission = {
  MEMBERS_READ: 'members:read',
  NOTES_READ: 'notes:read',
  NOTES_WRITE: 'notes:write',
  NOTES_DELETE: 'notes:delete',
  WARNINGS_READ: 'warnings:read',
  WARNINGS_WRITE: 'warnings:write',
  WARNINGS_REVOKE: 'warnings:revoke',
  SANCTIONS_READ: 'sanctions:read',
  SANCTIONS_WRITE: 'sanctions:write',
  SANCTIONS_REVOKE: 'sanctions:revoke',
  TICKETS_READ: 'tickets:read',
  TICKETS_WRITE: 'tickets:write',
  STATS_READ: 'stats:read',
  ROLES_MANAGE: 'roles:manage',
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  AUDIT_READ: 'audit:read',
  LOGS_READ: 'logs:read',
  LOGS_WRITE: 'logs:write',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const VIEWER_PERMISSIONS: Permission[] = [
  Permission.MEMBERS_READ,
  Permission.NOTES_READ,
  Permission.WARNINGS_READ,
  Permission.SANCTIONS_READ,
  Permission.TICKETS_READ,
  Permission.STATS_READ,
];

const MODERATOR_PERMISSIONS: Permission[] = [
  ...VIEWER_PERMISSIONS,
  Permission.NOTES_WRITE,
  Permission.WARNINGS_WRITE,
  Permission.WARNINGS_REVOKE,
  Permission.SANCTIONS_WRITE,
  Permission.SANCTIONS_REVOKE,
  Permission.TICKETS_WRITE,
  Permission.LOGS_READ,
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...MODERATOR_PERMISSIONS,
  Permission.NOTES_DELETE,
  // Regler ce qui est historise releve de la configuration du serveur, pas de
  // la moderation courante : un moderateur ne doit pas pouvoir faire
  // disparaitre une categorie entiere d'evenements de la chronologie.
  Permission.ROLES_MANAGE,
  Permission.USERS_READ,
  Permission.USERS_WRITE,
  Permission.AUDIT_READ,
  Permission.LOGS_WRITE,
];

export const ROLE_PERMISSIONS: Record<AppUserRole, readonly Permission[]> = {
  VIEWER: VIEWER_PERMISSIONS,
  MODERATOR: MODERATOR_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  OWNER: Object.values(Permission),
};

export function permissionsForRole(role: AppUserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(
  role: AppUserRole,
  permission: Permission,
): boolean {
  return permissionsForRole(role).includes(permission);
}

/** Ordre hierarchique : un compte ne peut pas agir sur un rang superieur. */
export const ROLE_RANK: Record<AppUserRole, number> = {
  VIEWER: 0,
  MODERATOR: 1,
  ADMIN: 2,
  OWNER: 3,
};
