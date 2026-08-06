/**
 * Contrats echanges entre l'API et le dashboard.
 *
 * Toutes les dates sont des chaines ISO 8601 : c'est ce qui transite reellement
 * en JSON. La conversion en `Date` est la responsabilite du consommateur.
 */

export type IsoDateString = string;

/** Identifiant Discord (snowflake), toujours manipule en chaine. */
export type Snowflake = string;

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  /** Erreurs de validation champ par champ, quand il y en a. */
  details?: Record<string, string[]>;
  timestamp: IsoDateString;
  path: string;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
