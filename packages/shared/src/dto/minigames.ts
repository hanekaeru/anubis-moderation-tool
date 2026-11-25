import type { MinigameType } from "../enums";
import type { IsoDateString, Snowflake } from "./common";
import type { MemberRef } from "./moderation";

/**
 * Contrats de la page Mini-jeux du dashboard.
 *
 * A la difference de la page OWdle, celle-ci **montre les reponses** : c'est
 * le staff qui les choisit. D'ou `minigames:read`, refusee aux comptes en
 * lecture seule.
 */

/**
 * Reglage d'un serveur. Sans ligne en base, l'API rend les valeurs par defaut
 * (`updatedAt` vaut alors `null`).
 */
export interface MinigameConfigDto {
	guildId: Snowflake;
	announceChannelId: Snowflake | null;
	playChannelId: Snowflake | null;
	pingRoleId: Snowflake | null;
	/** « HH:MM », heure de Paris. */
	pingTime: string;
	/** Sept cases, lundi en premier. */
	weekTemplate: (MinigameType | null)[];
	maxAttempts: number;
	heroXp: number[];
	mapXp: number[];
	skinXp: number[];
	trueFalseXp: number;
	outOfAttemptsMessage: string | null;
	updatedAt: IsoDateString | null;
}

export type UpdateMinigameConfigRequest = Partial<Omit<MinigameConfigDto, "guildId" | "updatedAt">>;

export interface MinigameMapDto {
	key: string;
	name: string;
	enabled: boolean;
	updatedAt: IsoDateString;
}

export interface CreateMinigameMapRequest {
	name: string;
}

export interface UpdateMinigameMapRequest {
	name?: string;
	enabled?: boolean;
}

/** Heros proposables comme reponse : ceux de l'OWdle. */
export interface MinigameHeroOption {
	key: string;
	name: string;
	enabled: boolean;
}

export interface MinigameImageDto {
	id: string;
	fileName: string;
	contentType: string;
	size: number;
	position: number;
}

export interface MinigameEventDto {
	id: string;
	/** « AAAA-MM-JJ », jour a l'heure de Paris. */
	day: string;
	type: MinigameType;
	title: string;
	description: string | null;
	color: number;
	pingEnabled: boolean;
	pingRoleId: Snowflake | null;
	maxAttempts: number | null;
	outOfAttemptsMessage: string | null;
	answerHeroKey: string | null;
	answerMapKey: string | null;
	answerSkin: string | null;
	answerTrue: boolean | null;
	pollQuestion: string | null;
	pollAnswers: string[];
	images: MinigameImageDto[];

	publishedAt: IsoDateString | null;
	pingedAt: IsoDateString | null;
	closedAt: IsoDateString | null;
	lastError: string | null;
	/** Lien vers la publication, quand elle existe. */
	messageUrl: string | null;

	/** Membres ayant joue, et ce qu'ils ont trouve. */
	participants: number;
	solved: number;
	heroOnly: number;

	/** Le jour a commence : seul un administrateur peut encore y toucher. */
	locked: boolean;
	updatedAt: IsoDateString;
}

/**
 * Un membre ayant joue a un mini-jeu. Pour les jeux a deviner, une ligne par
 * membre ayant depense au moins un essai ; pour le vrai ou faux, une ligne par
 * votant, posee a la fermeture. Le duel et le clip n'en ont aucune.
 */
export interface MinigameParticipantDto {
	member: MemberRef;
	attempts: number;
	/**
	 * Saisies dans l'ordre. Heros et maps en toutes lettres ; le skin tel que le
	 * bot l'a compare (minuscules, sans accents) ; « Vrai » ou « Faux » pour un vote.
	 */
	guesses: string[];
	heroFoundAt: IsoDateString | null;
	solvedAt: IsoDateString | null;
	xpAwarded: number;
	/** Dernier essai, ou vote enregistre. */
	playedAt: IsoDateString;
}

/** Corps d'une creation ; en modification, tout est facultatif sauf ce qui change. */
export interface SaveMinigameEventRequest {
	day: string;
	type: MinigameType;
	title: string;
	description?: string | null;
	color?: number;
	pingEnabled?: boolean;
	pingRoleId?: Snowflake | null;
	maxAttempts?: number | null;
	outOfAttemptsMessage?: string | null;
	answerHeroKey?: string | null;
	answerMapKey?: string | null;
	answerSkin?: string | null;
	answerTrue?: boolean | null;
	pollQuestion?: string | null;
	pollAnswers?: string[];
}

export type UpdateMinigameEventRequest = Partial<Omit<SaveMinigameEventRequest, "day">>;

export interface MinigameCalendarDto {
	config: MinigameConfigDto;
	/** Jeux de la periode demandee, par jour croissant. */
	events: MinigameEventDto[];
	/** Jour de jeu en cours, a l'heure de Paris. */
	today: string;
	heroes: MinigameHeroOption[];
	maps: MinigameMapDto[];
}

/**
 * Etat d'un jeu, tel que le calendrier l'affiche. Calcule et non stocke : il
 * se deduit des dates de publication et de fermeture.
 */
export type MinigameEventState = "SCHEDULED" | "LIVE" | "ENDED" | "MISSED" | "FAILED";

export function minigameEventState(
	event: Pick<MinigameEventDto, "day" | "publishedAt" | "closedAt" | "lastError">,
	today: string,
): MinigameEventState {
	if (event.closedAt) return "ENDED";
	if (event.publishedAt) return "LIVE";
	if (event.day < today) return "MISSED";
	if (event.lastError) return "FAILED";
	return "SCHEDULED";
}

export const MINIGAME_EVENT_STATE_LABELS: Record<MinigameEventState, string> = {
	SCHEDULED: "Prêt",
	LIVE: "En cours",
	ENDED: "Terminé",
	MISSED: "Non publié",
	FAILED: "Échec de publication",
};
