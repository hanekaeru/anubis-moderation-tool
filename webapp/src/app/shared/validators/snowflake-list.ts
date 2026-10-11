import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { SNOWFLAKE_PATTERN } from '@anubis/shared';

/**
 * Saisie d'une liste d'identifiants Discord, séparés par des virgules.
 *
 * Le dashboard n'a pas de sélecteur de rôles ni de salons — simplification
 * assumée, déjà en place sur les pages Sécurité et Expérience. Ce qui manquait,
 * c'est de **dire ce qui ne va pas** : une faute de frappe dans un identifiant
 * partait jusqu'à l'API, qui refusait la requête entière sans désigner le
 * fautif.
 *
 * Le séparateur est tolérant (virgule, point-virgule, espace, retour à la
 * ligne) : on colle souvent une liste venue d'ailleurs, et la refuser pour un
 * point-virgule n'apprend rien à personne.
 */
export function parseSnowflakeList(valeur: string): string[] {
	return valeur
		.split(/[\s,;]+/)
		.map((morceau) => morceau.trim())
		.filter(Boolean);
}

export function formatSnowflakeList(identifiants: readonly string[]): string {
	return identifiants.join(', ');
}

/**
 * Le message d'erreur nomme **le premier identifiant fautif**, pas seulement la
 * règle : dans une liste de dix, « l'un d'eux est invalide » oblige à les
 * relire un par un.
 */
export function listeDeSnowflakes(maximum: number, quoi: string): ValidatorFn {
	return (control: AbstractControl): ValidationErrors | null => {
		const identifiants = parseSnowflakeList(String(control.value ?? ''));
		if (!identifiants.length) return null;

		const fautif = identifiants.find((id) => !SNOWFLAKE_PATTERN.test(id));
		if (fautif) {
			return {
				snowflakes: `« ${fautif} » n'est pas un identifiant Discord (17 à 20 chiffres).`,
			};
		}

		if (identifiants.length > maximum) {
			return { snowflakes: `${maximum} ${quoi}s au maximum (${identifiants.length} saisis).` };
		}

		const doublon = identifiants.find((id, i) => identifiants.indexOf(id) !== i);
		if (doublon) {
			return { snowflakes: `L'identifiant ${doublon} est présent deux fois.` };
		}

		return null;
	};
}
