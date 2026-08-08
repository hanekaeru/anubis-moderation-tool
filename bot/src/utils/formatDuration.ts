import { DURATION_UNIT_LABELS, DurationUnit } from '@anubis/shared';

/** Formate la duree telle que saisie par le moderateur (`16 jours`, `Permanent`). */
export function formatDuration(amount: number, unit: DurationUnit): string {
    if (unit === DurationUnit.PERMANENT) return DURATION_UNIT_LABELS.PERMANENT;

    return `${amount} ${DURATION_UNIT_LABELS[unit].toLowerCase()}`;
}
