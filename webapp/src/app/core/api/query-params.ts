import { HttpParams } from '@angular/common/http';

/**
 * Construit des parametres de requete en ignorant les valeurs vides.
 *
 * Sans ce filtrage, un filtre laisse a blanc partirait en `?search=` et l'API
 * le traiterait comme une recherche sur la chaine vide.
 */
export function toHttpParams(query: object | undefined): HttpParams {
	let params = new HttpParams();
	if (!query) return params;

	// `object` et non `Record<string, unknown>` : les DTO partages sont des
	// interfaces, qui n'ont pas de signature d'index et seraient donc refusees.
	for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
		if (value === undefined || value === null || value === '') continue;

		if (Array.isArray(value)) {
			for (const item of value) {
				params = params.append(key, String(item));
			}
		} else {
			params = params.set(key, String(value));
		}
	}

	return params;
}
