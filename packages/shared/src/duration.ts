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
