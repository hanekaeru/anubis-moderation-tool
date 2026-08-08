/**
 * Duree d'une sanction exprimee comme une quantite dans une unite, plutot que
 * des presets fixes : utilise par les commandes Discord (`/mute`, `/shadowban`,
 * ...) sous la forme `<duree> <unite>`.
 */
export const DurationUnit = {
  SECONDS: 'SECONDS',
  MINUTES: 'MINUTES',
  HOURS: 'HOURS',
  DAYS: 'DAYS',
  WEEKS: 'WEEKS',
  MONTHS: 'MONTHS',
  YEARS: 'YEARS',
  PERMANENT: 'PERMANENT',
} as const;
export type DurationUnit = (typeof DurationUnit)[keyof typeof DurationUnit];

export const DURATION_UNIT_LABELS: Record<DurationUnit, string> = {
  SECONDS: 'Secondes',
  MINUTES: 'Minutes',
  HOURS: 'Heures',
  DAYS: 'Jours',
  WEEKS: 'Semaines',
  MONTHS: 'Mois',
  YEARS: 'Années',
  PERMANENT: 'Permanent',
};

/**
 * Mois et annees sont approximes a 30 et 365 jours : aucune sanction n'a
 * besoin de la precision calendaire exacte, seulement d'un ordre de grandeur
 * stable.
 */
const DURATION_UNIT_SECONDS: Record<Exclude<DurationUnit, 'PERMANENT'>, number> = {
  SECONDS: 1,
  MINUTES: 60,
  HOURS: 60 * 60,
  DAYS: 24 * 60 * 60,
  WEEKS: 7 * 24 * 60 * 60,
  MONTHS: 30 * 24 * 60 * 60,
  YEARS: 365 * 24 * 60 * 60,
};

/** Unites proposees dans les commandes qui acceptent une sanction permanente. */
export const DURATION_UNIT_CHOICES_WITH_PERMANENT = Object.values(DurationUnit);

/** Unites proposees la ou Discord exige toujours une duree (ex. timeout natif). */
export const DURATION_UNIT_CHOICES_TIMED = Object.values(DurationUnit)
  .filter((unit): unit is Exclude<DurationUnit, 'PERMANENT'> => unit !== DurationUnit.PERMANENT);

/** Null = sanction permanente. */
export function durationToSeconds(amount: number, unit: DurationUnit): number | null {
  if (unit === DurationUnit.PERMANENT) return null;
  return amount * DURATION_UNIT_SECONDS[unit];
}

/**
 * Duree stockee (en secondes) vers une forme lisible : `2 j 4 h`, `35 min`.
 *
 * L'inverse de `durationToSeconds`, pour reafficher une duree enregistree sans
 * connaitre l'unite saisie a l'origine. `fallback` couvre l'absence de duree,
 * qui signifie « permanent » sur une sanction.
 */
export function formatDurationSeconds(
  seconds: number | null | undefined,
  fallback = 'Permanent',
): string {
  if (seconds === null || seconds === undefined) return fallback;
  if (seconds < 60) return `${Math.round(seconds)} s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const resteMinutes = minutes % 60;
  if (hours < 24) {
    return resteMinutes ? `${hours} h ${resteMinutes} min` : `${hours} h`;
  }

  const days = Math.floor(hours / 24);
  const resteHeures = hours % 24;
  return resteHeures ? `${days} j ${resteHeures} h` : `${days} j`;
}
