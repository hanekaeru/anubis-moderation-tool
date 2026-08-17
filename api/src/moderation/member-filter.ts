import type { Prisma } from "@anubis/shared/prisma";

/**
 * Filtre « membre » des listes d'avertissements et de sanctions.
 *
 * Partage entre les deux services : la meme saisie doit se comporter de la
 * meme facon sur les deux pages, et deux copies finiraient par diverger sur un
 * detail (la casse, l'identifiant) qui se voit immediatement a l'usage.
 *
 * La recherche porte sur le pseudo **et** le nom affiche, parce que le staff
 * connait l'un ou l'autre selon les membres, et sur l'identifiant lui-meme
 * pour le cas ou il est colle depuis Discord. `mode: "insensitive"` n'est pas
 * optionnel : les pseudos Discord sont libres en casse, une recherche sensible
 * ne trouverait rien la moitie du temps.
 *
 * Renvoie un objet vide quand la saisie est vide : le repandre dans un `where`
 * sans condition revient a ne pas filtrer, ce qui est bien le comportement
 * attendu d'un champ de recherche laisse libre.
 */
export function memberSearchFilter(term: string | undefined): {
	user?: Prisma.DiscordUserWhereInput;
} {
	const cleaned = term?.trim();
	if (!cleaned) return {};

	return {
		user: {
			OR: [
				{ username: { contains: cleaned, mode: "insensitive" } },
				{ globalName: { contains: cleaned, mode: "insensitive" } },
				{ id: { contains: cleaned } },
			],
		},
	};
}
