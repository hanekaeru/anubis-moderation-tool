import type { OwdleAffiliationRef, OwdleHero } from "../owdle";
import { IsoDateString, Snowflake } from "./common";

/**
 * Contrats de la page OWdle du dashboard.
 *
 * La page ne montre **jamais** le heros du jour : le staff joue aussi, et
 * l'avoir sous les yeux en ouvrant ses reglages gacherait la partie.
 */

export interface OwdleHeroDto extends OwdleHero {
	/** Desactive : ni tire, ni proposable. Ses parties passees restent lisibles. */
	enabled: boolean;
	updatedAt: IsoDateString;
}

export interface OwdleAffiliationDto extends OwdleAffiliationRef {
	/** Heros qui la portent : non nul, elle ne peut pas etre supprimee. */
	heroCount: number;
}

/**
 * Reglage de l'OWdle d'un serveur.
 *
 * Pas de `discordSyncedAt` : rien n'est a rejouer sur Discord, le bot relit le
 * bareme a chaque victoire (cache court).
 */
export interface OwdleConfigDto {
	guildId: Snowflake;
	/** Salon des annonces de victoire, `null` = le salon de la partie. */
	channelId: Snowflake | null;
	/**
	 * Experience par nombre d'essais : `[0]` pour une victoire du premier coup,
	 * la derniere valeur pour tout essai au-dela de la liste.
	 */
	xpByGuesses: number[];
	updatedAt: IsoDateString;
}

export interface OwdleOverviewDto {
	heroes: OwdleHeroDto[];
	affiliations: OwdleAffiliationDto[];
	config: OwdleConfigDto;
}

/** Un heros tel qu'on l'envoie : l'affiliation se designe par sa cle. */
export interface CreateOwdleHeroRequest extends Omit<OwdleHero, "affiliation"> {
	affiliationKey: string;
	enabled?: boolean;
}

/** La cle ne figure pas : elle vit dans les parties enregistrees. */
export type UpdateOwdleHeroRequest = Partial<Omit<CreateOwdleHeroRequest, "key">>;

/** La cle se deduit du libelle cote API, a la creation seulement. */
export interface SaveOwdleAffiliationRequest {
	label: string;
}

export interface UpdateOwdleConfigRequest {
	channelId?: Snowflake | null;
	/** Remplace en bloc, comme toutes les listes reglees depuis le dashboard. */
	xpByGuesses?: number[];
}
