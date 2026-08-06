import { AppUserRole } from '../enums';
import { IsoDateString, PaginationQuery, Snowflake } from './common';

export interface AppUserDto {
  id: string;
  username: string;
  displayName: string;
  role: AppUserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  discordUserId: Snowflake | null;
  lastLoginAt: IsoDateString | null;
  lockedUntil: IsoDateString | null;
  createdAt: IsoDateString;
  createdByLabel: string | null;
}

export interface CreateAppUserRequest {
  username: string;
  displayName: string;
  role: AppUserRole;
  /**
   * Mot de passe initial. Omis, l'API en genere un et le renvoie une seule
   * fois dans `generatedPassword` : c'est le mode a privilegier.
   */
  password?: string;
  discordUserId?: Snowflake | null;
}

export interface CreateAppUserResponse {
  user: AppUserDto;
  /** Renvoye une seule fois, a la creation. Jamais relisible ensuite. */
  generatedPassword: string | null;
}

export interface UpdateAppUserRequest {
  displayName?: string;
  role?: AppUserRole;
  isActive?: boolean;
  discordUserId?: Snowflake | null;
}

export interface ResetPasswordResponse {
  generatedPassword: string;
}

export interface AppUserSearchQuery extends PaginationQuery {
  search?: string;
  role?: AppUserRole;
  isActive?: boolean;
}

export interface AuditLogEntryDto {
  id: string;
  actorLabel: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  createdAt: IsoDateString;
}

export interface AuditLogQuery extends PaginationQuery {
  appUserId?: string;
  action?: string;
  from?: IsoDateString;
  to?: IsoDateString;
}
