import { EmbedMessageStatus } from "../enums";
import { IsoDateString, PaginationQuery, Snowflake } from "./common";
import { ActorRef } from "./moderation";

/**
 * Contrats du module d'envoi d'embeds.
 *
 * Le dashboard compose le message et choisit le salon ; **l'API ne parle jamais
 * a Discord**. Elle enregistre la ligne avec `discordSyncedAt` a `null`, et le
 * bot repasse pour publier ou corriger. Meme patron que les concours, et pour
 * la meme raison : seul le process bot detient une connexion a la passerelle.
 */

export interface EmbedFieldDto {
	name: string;
	value: string;
	inline: boolean;
}

export interface EmbedMessageDto {
	id: string;
	guildId: Snowflake;
	channelId: Snowflake;
	/** `null` tant que le message n'a pas ete publie sur Discord. */
	messageId: Snowflake | null;
	/** Nom interne, affiche dans la liste du dashboard uniquement. */
	name: string;
	content: string | null;
	title: string | null;
	description: string | null;
	/** Couleur de la barre laterale, entier Discord (`0xRRGGBB`). */
	color: number;
	url: string | null;
	authorName: string | null;
	authorIconUrl: string | null;
	thumbnailUrl: string | null;
	imageUrl: string | null;
	footerText: string | null;
	footerIconUrl: string | null;
	fields: EmbedFieldDto[];
	showTimestamp: boolean;
	status: EmbedMessageStatus;
	/** Raison du dernier refus de Discord, quand `status` vaut `FAILED`. */
	lastError: string | null;
	createdBy: ActorRef;
	/** `null` tant que le bot n'a pas repercute la derniere ecriture. */
	discordSyncedAt: IsoDateString | null;
	sentAt: IsoDateString | null;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
}

export interface EmbedMessagePayload {
	channelId: Snowflake;
	name: string;
	content?: string | null;
	title?: string | null;
	description?: string | null;
	color?: number;
	url?: string | null;
	authorName?: string | null;
	authorIconUrl?: string | null;
	thumbnailUrl?: string | null;
	imageUrl?: string | null;
	footerText?: string | null;
	footerIconUrl?: string | null;
	fields?: EmbedFieldDto[];
	showTimestamp?: boolean;
}

export type CreateEmbedMessageRequest = EmbedMessagePayload;

/**
 * Modification d'un message.
 *
 * `channelId` en est absent : deplacer un message deja publie supposerait de le
 * supprimer et d'en republier un autre, donc de perdre les reactions et les
 * epinglages. Pour changer de salon, on duplique.
 */
export type UpdateEmbedMessageRequest = Partial<Omit<EmbedMessagePayload, "channelId">>;

export interface EmbedMessageSearchQuery extends PaginationQuery {
	status?: EmbedMessageStatus;
}

/** Couleur proposee par defaut (indigo Material), lisible dans les deux themes Discord. */
export const DEFAULT_EMBED_COLOR = 0x5865f2;

/** Limites de Discord, appliquees a l'identique par l'API et le formulaire. */
export const EMBED_LIMITS = {
	title: 256,
	description: 4096,
	fieldName: 256,
	fieldValue: 1024,
	footerText: 2048,
	authorName: 256,
	content: 2000,
	/** Discord refuse au-dela de 25 champs. */
	fields: 25,
	/** Nom interne, jamais envoye a Discord. */
	name: 120,
} as const;

/**
 * Total de caracteres accepte par Discord pour un embed, tous champs confondus.
 *
 * Chaque champ tient dans sa propre limite bien avant d'atteindre ce total :
 * c'est leur **somme** que Discord refuse, et un embed compose de vingt-cinq
 * champs valides peut donc etre rejete. Le compte est fait ici pour que le
 * formulaire l'annonce avant l'envoi plutot que de laisser le bot echouer.
 */
export const EMBED_TOTAL_LIMIT = 6000;

export function embedCharacterCount(embed: {
	title?: string | null;
	description?: string | null;
	footerText?: string | null;
	authorName?: string | null;
	fields?: readonly EmbedFieldDto[];
}): number {
	const fields = embed.fields ?? [];

	return (
		(embed.title?.length ?? 0) +
		(embed.description?.length ?? 0) +
		(embed.footerText?.length ?? 0) +
		(embed.authorName?.length ?? 0) +
		fields.reduce((total, field) => total + field.name.length + field.value.length, 0)
	);
}

/**
 * Un embed doit porter au moins un contenu visible.
 *
 * Discord refuse un embed entierement vide, et un message qui n'aurait que sa
 * couleur ne dirait rien : la regle vit ici pour que le formulaire refuse
 * exactement ce que l'API refuse.
 */
export function hasEmbedContent(embed: {
	title?: string | null;
	description?: string | null;
	imageUrl?: string | null;
	thumbnailUrl?: string | null;
	authorName?: string | null;
	footerText?: string | null;
	fields?: readonly EmbedFieldDto[];
}): boolean {
	return Boolean(
		embed.title ||
			embed.description ||
			embed.imageUrl ||
			embed.thumbnailUrl ||
			embed.authorName ||
			embed.footerText ||
			(embed.fields?.length ?? 0) > 0,
	);
}
