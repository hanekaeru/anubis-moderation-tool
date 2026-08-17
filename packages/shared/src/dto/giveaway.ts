import { GiveawayStatus } from "../enums";
import { IsoDateString, PaginationQuery, Snowflake } from "./common";
import { ActorRef, MemberRef } from "./moderation";

/**
 * Contrats du module concours.
 *
 * Un concours se cree indifferemment depuis le dashboard ou depuis `/giveaway`
 * sur Discord ; les deux chemins ecrivent la meme ligne. Seul le bot publie
 * l'embed, pose la reaction et procede au tirage — l'API ne parle jamais a
 * Discord.
 */

export interface GiveawayEntryDto {
	member: MemberRef;
	isWinner: boolean;
	enteredAt: IsoDateString;
}

export interface GiveawayDto {
	id: string;
	guildId: Snowflake;
	channelId: Snowflake;
	/** `null` tant que l'embed n'a pas ete publie sur Discord. */
	messageId: Snowflake | null;
	title: string;
	description: string | null;
	prize: string;
	imageUrl: string | null;
	reactionEmoji: string;
	winnerCount: number;
	/** A `null`, l'annonce du gagnant tombe dans le salon du concours. */
	announceChannelId: Snowflake | null;
	status: GiveawayStatus;
	endsAt: IsoDateString;
	createdBy: ActorRef;
	entryCount: number;
	winners: MemberRef[];
	/** `null` tant que le bot n'a pas repercute la derniere ecriture sur Discord. */
	discordSyncedAt: IsoDateString | null;
	endedAt: IsoDateString | null;
	createdAt: IsoDateString;
}

export interface CreateGiveawayRequest {
	channelId: Snowflake;
	title: string;
	description?: string | null;
	prize: string;
	imageUrl?: string | null;
	reactionEmoji?: string;
	winnerCount?: number;
	announceChannelId?: Snowflake | null;
	/** Duree en minutes, comptee a partir de l'enregistrement. */
	durationMinutes: number;
}

/**
 * Modification d'un concours.
 *
 * Tout est facultatif, mais seul un concours qui n'est pas encore termine peut
 * etre modifie : rien ne se rejoue sur un tirage deja annonce.
 */
export interface UpdateGiveawayRequest {
	title?: string;
	description?: string | null;
	prize?: string;
	imageUrl?: string | null;
	reactionEmoji?: string;
	winnerCount?: number;
	announceChannelId?: Snowflake | null;
	durationMinutes?: number;
}

export interface GiveawaySearchQuery extends PaginationQuery {
	status?: GiveawayStatus;
}

/** Reaction proposee par defaut, la plus lisible sur tous les clients Discord. */
export const DEFAULT_GIVEAWAY_EMOJI = "🎉";

export const MAX_GIVEAWAY_WINNERS = 20;

/**
 * Duree minimale d'un concours, en minutes.
 *
 * En dessous, la tache de rattrapage du bot (un passage toutes les cinq
 * secondes) risque de publier l'embed alors que le concours est deja echu.
 */
export const MIN_GIVEAWAY_DURATION_MINUTES = 1;

/** Un mois : au-dela, un concours oublie tiendrait un message ouvert sans fin. */
export const MAX_GIVEAWAY_DURATION_MINUTES = 60 * 24 * 31;

/**
 * Emoji de participation accepte : soit un emoji personnalise du serveur sous
 * sa forme `<:nom:id>` / `<a:nom:id>`, soit une suite de caracteres courte pour
 * les emojis Unicode.
 *
 * La verification qui fait foi reste celle de Discord au moment de poser la
 * reaction : ce filtre n'ecarte que les valeurs manifestement absurdes, comme
 * une phrase entiere collee dans le champ.
 */
export function isValidGiveawayEmoji(emoji: string): boolean {
	if (/^<a?:[a-zA-Z0-9_]{2,32}:\d{17,20}>$/.test(emoji)) return true;
	// Un emoji Unicode tient en quelques points de code (jusqu'aux sequences
	// composees avec jointeur de largeur nulle, comme les drapeaux ou familles).
	return emoji.length > 0 && [...emoji].length <= 8 && !/\s/.test(emoji);
}
