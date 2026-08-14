import { AutomodAction, AutomodRuleType } from "../enums";
import { IsoDateString, PaginationQuery, Snowflake } from "./common";
import { MemberRef } from "./moderation";

/**
 * Forme de `AutomodRule.settings` selon `type` — JSON non type en base
 * (comme `TicketEvent.payload`), type ici cote applicatif.
 */
export interface SpamRateSettings {
	messageThreshold: number;
	windowSeconds: number;
}

export interface MassMentionsSettings {
	mentionThreshold: number;
}

export interface LinksInvitesSettings {
	blockLinks: boolean;
	blockInvites: boolean;
	allowedDomains: string[];
}

export interface WordFilterSettings {
	words: string[];
}

export interface ExcessiveCapsSettings {
	/** Longueur minimale du message avant d'appliquer la regle. */
	minLength: number;
	/** Ratio de majuscules (0 a 1) au-dela duquel la regle se declenche. */
	capsRatio: number;
}

export interface RepetitionSettings {
	/** Nombre de caracteres identiques consecutifs tolere dans un message. */
	maxRepeatedChars: number;
	/** Nombre de messages identiques consecutifs tolere pour un membre. */
	maxDuplicateMessages: number;
}

export type AutomodRuleSettings =
	| SpamRateSettings
	| MassMentionsSettings
	| LinksInvitesSettings
	| WordFilterSettings
	| ExcessiveCapsSettings
	| RepetitionSettings;

export interface AutomodRuleDto {
	id: string;
	guildId: Snowflake;
	type: AutomodRuleType;
	enabled: boolean;
	action: AutomodAction;
	timeoutSeconds: number | null;
	settings: AutomodRuleSettings;
	exemptRoleIds: Snowflake[];
	updatedAt: IsoDateString;
}

export interface UpdateAutomodRuleRequest {
	enabled?: boolean;
	action?: AutomodAction;
	timeoutSeconds?: number | null;
	settings?: AutomodRuleSettings;
	exemptRoleIds?: Snowflake[];
}

export interface AutomodAttachmentRef {
	fileName: string;
	contentType: string;
	size: number;
}

export interface AutomodIncidentDto {
	id: string;
	guildId: Snowflake;
	ruleType: AutomodRuleType;
	member: MemberRef;
	channelId: Snowflake | null;
	action: AutomodAction;
	messageContent: string | null;
	messageAttachments: AutomodAttachmentRef[];
	details: Record<string, unknown> | null;
	occurredAt: IsoDateString;
}

export interface AutomodIncidentSearchQuery extends PaginationQuery {
	ruleType?: AutomodRuleType;
	userId?: Snowflake;
	from?: IsoDateString;
	to?: IsoDateString;
}

/** Valeurs par defaut affichees dans le formulaire tant qu'une regle n'a jamais ete enregistree. */
export const DEFAULT_AUTOMOD_SETTINGS: Record<AutomodRuleType, AutomodRuleSettings> = {
	SPAM_RATE: { messageThreshold: 5, windowSeconds: 5 },
	MASS_MENTIONS: { mentionThreshold: 5 },
	LINKS_INVITES: { blockLinks: false, blockInvites: true, allowedDomains: [] },
	WORD_FILTER: { words: [] },
	EXCESSIVE_CAPS: { minLength: 10, capsRatio: 0.7 },
	REPETITION: { maxRepeatedChars: 6, maxDuplicateMessages: 3 },
};
