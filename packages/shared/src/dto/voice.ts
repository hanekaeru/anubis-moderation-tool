import type { VoicePlacementMode } from "../enums";
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

/**
 * Gabarit par defaut du sujet des salons crees.
 *
 * Le rang et la plateforme vivent dans le **sujet** et non dans le nom :
 * Discord n'autorise que deux renommages par dix minutes et par salon, et un
 * proprietaire qui corrige son rang puis sa plateforme atteindrait le plafond
 * du premier coup.
 */
export const DEFAULT_VOICE_STATUS_PATTERN = "{rang} {plateforme} · {sujet}";

/** Plafond Discord du sujet d'un salon vocal. */
export const MAX_VOICE_STATUS_LENGTH = 500;

/** Plafond de la partie libre du sujet, saisie par le proprietaire. */
export const MAX_VOICE_TOPIC_LENGTH = 200;

/** Nombre de rangs (ou de plateformes) proposables par salon de creation. */
export const MAX_VOICE_HUB_OPTIONS = 25;

/** Nom par defaut de la categorie ou atterrissent les salons crees. */
export const DEFAULT_VOICE_LANDING_CATEGORY = "En attente";

/**
 * Plafond Discord de salons dans une categorie.
 *
 * Partage avec le bot, qui le verifie avant de deplacer un salon : le
 * dashboard s'en sert pour expliquer le refus plutot que de le subir.
 */
export const MAX_CHANNELS_PER_CATEGORY = 50;

/**
 * Rang propose dans les options de personnalisation d'un salon temporaire.
 *
 * C'est le seul reglage qui **range** le salon : le choisir le deplace dans
 * `categoryId`.
 */
export interface VoiceHubRankDto {
	id: string;
	label: string;
	/** Unicode ou `<:nom:id>` : le sujet accepte les emojis personnalises. */
	emoji: string | null;
	/**
	 * Categorie Discord ou sont deplaces les salons portant ce rang.
	 *
	 * `null` tant qu'aucun salon n'a pris ce rang : le bot cree alors une
	 * categorie nommee d'apres le libelle et retient son identifiant ici.
	 */
	categoryId: Snowflake | null;
	position: number;
}

/** Plateforme proposee au proprietaire. Descriptive : elle ne range rien. */
export interface VoiceHubPlatformDto {
	id: string;
	label: string;
	emoji: string | null;
	position: number;
}

export interface VoiceHubDto {
	id: string;
	guildId: Snowflake;
	/** `null` tant que `/create_parties` n'a pas cree le salon Discord. */
	channelId: Snowflake | null;
	name: string;
	namePattern: string;
	/** `{rang}`, `{plateforme}` et `{sujet}` y sont remplaces. */
	statusPattern: string;
	/** Ce qui decide de la categorie des salons crees. */
	placementMode: VoicePlacementMode;
	/** Categorie ou atterrissent les salons crees, creee au besoin. */
	landingCategoryName: string;
	/** Rempli par le bot a la premiere creation. */
	landingCategoryId: Snowflake | null;
	/** 0 = illimite, comme Discord. */
	userLimit: number;
	position: number;
	enabled: boolean;
	/** Vide : le hub ne propose aucun rang, et ne range donc aucun salon. */
	ranks: VoiceHubRankDto[];
	platforms: VoiceHubPlatformDto[];
	/** Salons temporaires actuellement ouverts pour ce salon de creation. */
	activeChannels: number;
	updatedAt: IsoDateString;
}

export interface CreateVoiceHubRequest {
	name: string;
	namePattern?: string;
	statusPattern?: string;
	placementMode?: VoicePlacementMode;
	landingCategoryName?: string;
	/** Vider ce champ fait retrouver — ou recreer — la categorie d'accueil. */
	landingCategoryId?: Snowflake | null;
	userLimit?: number;
	position?: number;
	enabled?: boolean;
}

export interface UpdateVoiceHubRequest {
	name?: string;
	namePattern?: string;
	statusPattern?: string;
	placementMode?: VoicePlacementMode;
	landingCategoryName?: string;
	landingCategoryId?: Snowflake | null;
	userLimit?: number;
	position?: number;
	enabled?: boolean;
}

export interface CreateVoiceHubRankRequest {
	label: string;
	emoji?: string | null;
	/** Facultatif : sans lui, le bot cree la categorie au premier usage. */
	categoryId?: Snowflake | null;
	position?: number;
}

export interface UpdateVoiceHubRankRequest {
	label?: string;
	emoji?: string | null;
	categoryId?: Snowflake | null;
	position?: number;
}

export interface CreateVoiceHubPlatformRequest {
	label: string;
	emoji?: string | null;
	position?: number;
}

export interface UpdateVoiceHubPlatformRequest {
	label?: string;
	emoji?: string | null;
	position?: number;
}

/** Une option telle qu'elle s'ecrit dans le sujet : emoji puis libelle. */
export interface VoiceStatusOption {
	label: string;
	emoji?: string | null;
}

export interface VoiceStatusContext {
	rank?: VoiceStatusOption | null;
	platform?: VoiceStatusOption | null;
	topic?: string | null;
}

function formatOption(option?: VoiceStatusOption | null): string {
	if (!option) return "";
	return option.emoji ? `${option.emoji} ${option.label}` : option.label;
}

/**
 * Compose le sujet d'un salon temporaire a partir du gabarit de son hub.
 *
 * Le bot pousse le resultat sur Discord et le dashboard le previsualise par
 * cette meme fonction : recopiee aux deux endroits, l'apercu finirait par
 * mentir sur ce que voit le serveur.
 *
 * Un salon n'a longtemps aucun rang ni plateforme — ils se choisissent apres
 * l'arrivee. Les jetons vides sont donc retires **avec les separateurs restes
 * orphelins**, sans quoi un salon sans plateforme afficherait « Or  · » suivi
 * de rien.
 */
export function renderVoiceStatus(
	pattern: string,
	context: VoiceStatusContext,
): string {
	const rendered = pattern
		.replaceAll("{rang}", formatOption(context.rank))
		.replaceAll("{plateforme}", formatOption(context.platform))
		.replaceAll("{sujet}", context.topic?.trim() ?? "");

	return rendered
		// Separateurs laisses par un jeton vide : « Or  · » ou « · PC ».
		.replace(/\s*[·|\-–—]\s*(?=\s*[·|\-–—]|$)/g, "")
		.replace(/^\s*[·|\-–—]\s*/, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_VOICE_STATUS_LENGTH);
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
