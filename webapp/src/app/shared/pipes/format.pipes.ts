import { Pipe, PipeTransform } from '@angular/core';

/**
 * Duree en secondes vers une forme lisible : "2 j 4 h", "35 min".
 *
 * L'absence de valeur ne veut pas dire la meme chose partout : pour une
 * sanction c'est "Permanent", pour un delai de reponse c'est "pas de donnee".
 * Le libelle se passe donc en argument plutot que d'etre suppose ici.
 *
 *   {{ sanction.durationSeconds | duration: 'Permanent' }}
 *   {{ delaiMedian | duration }}
 */
@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(seconds: number | null | undefined, emptyLabel = '—'): string {
    if (seconds === null || seconds === undefined) return emptyLabel;
    if (seconds < 60) return `${Math.round(seconds)} s`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) {
      return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
    }

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours ? `${days} j ${remainingHours} h` : `${days} j`;
  }
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/**
 * Date ISO vers formulation relative : "il y a 3 jours".
 *
 * Impur volontairement : "il y a 2 minutes" doit vieillir tant que la page
 * reste ouverte. Le cout est negligeable a l'echelle d'un tableau de bord.
 */
@Pipe({ name: 'relativeTime', pure: false })
export class RelativeTimePipe implements PipeTransform {
  private readonly formatter = new Intl.RelativeTimeFormat('fr', {
    numeric: 'auto',
  });

  transform(value: string | null | undefined): string {
    if (!value) return '—';

    const elapsed = new Date(value).getTime() - Date.now();
    const absolute = Math.abs(elapsed);

    for (const [unit, milliseconds] of RELATIVE_UNITS) {
      if (absolute >= milliseconds) {
        return this.formatter.format(Math.round(elapsed / milliseconds), unit);
      }
    }

    return "a l'instant";
  }
}

/** Date ISO vers date lisible complete. */
@Pipe({ name: 'frDate' })
export class FrDatePipe implements PipeTransform {
  private readonly formatter = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  transform(value: string | null | undefined): string {
    if (!value) return '—';
    return this.formatter.format(new Date(value));
  }
}
