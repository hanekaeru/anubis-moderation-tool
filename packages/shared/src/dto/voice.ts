import type { IsoDateString, PaginationQuery, Snowflake } from "./common";

/**
 * Une presence en salon vocal, de l'arrivee au depart.
 *
 * Un changement de salon produit deux sessions : le temps passe est rattache au
 * salon ou il a reellement ete passe.
 */
export interface VoiceSessionDto {
	/** `BigInt` cote base, toujours transporte en chaine. */
	id: string;
	channelId: Snowflake;
	/** `null` si le salon a ete supprime depuis. */
	channelName: string | null;
	joinedAt: IsoDateString;
	leftAt: IsoDateString | null;
	durationSeconds: number | null;
	/** Session encore ouverte : le membre est actuellement en vocal. */
	ongoing: boolean;
}

export type VoiceSessionQuery = PaginationQuery;

/** Gabarit par defaut du nom des salons crees par un salon de creation. */
export const DEFAULT_VOICE_NAME_PATTERN = "{name} #{index}";

export interface VoiceHubDto {
	id: string;
	guildId: Snowflake;
	/** `null` tant que `/create_parties` n'a pas cree le salon Discord. */
	channelId: Snowflake | null;
	name: string;
	namePattern: string;
	/** 0 = illimite, comme Discord. */
	userLimit: number;
	position: number;
	enabled: boolean;
	/** Salons temporaires actuellement ouverts pour ce salon de creation. */
	activeChannels: number;
	updatedAt: IsoDateString;
}

export interface CreateVoiceHubRequest {
	name: string;
	namePattern?: string;
	userLimit?: number;
	position?: number;
	enabled?: boolean;
}

export interface UpdateVoiceHubRequest {
	name?: string;
	namePattern?: string;
	userLimit?: number;
	position?: number;
	enabled?: boolean;
}

export interface VoiceOccupantDto {
	userId: Snowflake;
	username: string;
	displayName: string | null;
	avatarUrl: string | null;
	joinedAt: IsoDateString;
	/** Proprietaire du salon temporaire, le cas echeant. */
	owner: boolean;
}

/**
 * Un salon vocal actuellement occupe.
 *
 * Deduit des sessions vocales encore ouvertes : rien n'est duplique en base, et
 * la vue reflete donc exactement ce que le bot a enregistre.
 */
export interface LiveVoiceChannelDto {
	channelId: Snowflake;
	name: string;
	/** Salon cree automatiquement par un salon de creation. */
	temporary: boolean;
	/** Nom du salon de creation d'origine, pour un salon temporaire. */
	hubName: string | null;
	locked: boolean;
	occupantCount: number;
	occupants: VoiceOccupantDto[];
	/** Ouverture du salon temporaire ; arrivee du plus ancien occupant sinon. */
	since: IsoDateString;
}

export interface LiveVoiceDto {
	channels: LiveVoiceChannelDto[];
	totalOccupants: number;
	/** Salons temporaires ouverts, tous salons de creation confondus. */
	temporaryChannels: number;
	checkedAt: IsoDateString;
}
