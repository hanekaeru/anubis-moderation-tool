import { avatarUrl, type ActorRef, type MemberRef, type RoleSummary } from '@anubis/shared';

/** Forme minimale attendue pour construire une reference de membre. */
export interface DiscordUserLike {
  id: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
}

export interface AppUserLike {
  id: string;
  displayName: string;
  username: string;
}

export function toMemberRef(user: DiscordUserLike): MemberRef {
  return {
    userId: user.id,
    username: user.username,
    globalName: user.globalName,
    avatarUrl: avatarUrl(user.id, user.avatarHash),
  };
}

/**
 * Une action peut venir d'un moderateur Discord (commande du bot) ou d'un
 * compte dashboard. Cette fonction choisit la source disponible et retombe sur
 * "systeme" quand l'auteur n'a pas ete conserve.
 */
export function toActorRef(
  discordUser: DiscordUserLike | null | undefined,
  appUser: AppUserLike | null | undefined,
): ActorRef {
  if (appUser) {
    return { kind: 'app', id: appUser.id, label: appUser.displayName };
  }
  if (discordUser) {
    return {
      kind: 'discord',
      id: discordUser.id,
      label: discordUser.globalName ?? discordUser.username,
    };
  }
  return { kind: 'system', id: null, label: 'Systeme' };
}

export function toRoleSummary(role: {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
  trackHistory: boolean;
}): RoleSummary {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
    managed: role.managed,
    trackHistory: role.trackHistory,
  };
}

/** Trie les roles comme Discord les affiche : du plus haut au plus bas. */
export function sortRoles(roles: RoleSummary[]): RoleSummary[] {
  return [...roles].sort((a, b) => b.position - a.position);
}

/**
 * Complete une serie temporelle pour qu'aucun jour ne manque entre `from` et
 * `to`. Sans cela, les graphiques relient deux points distants et laissent
 * croire a une activite continue.
 */
export function fillDailySeries(
  counts: Map<string, number>,
  from: Date,
  to: Date,
): { date: string; value: number }[] {
  const points: { date: string; value: number }[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());

  while (cursor.getTime() <= end) {
    const key = cursor.toISOString().slice(0, 10);
    points.push({ date: key, value: counts.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return points;
}

/** Clef de jour (YYYY-MM-DD) en UTC, cohérente avec la colonne `day`. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
