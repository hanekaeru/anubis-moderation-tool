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

export interface AttachmentSpamSettings {
	/** Nombre de pieces jointes tolerees dans la fenetre, tous messages confondus. */
	attachmentThreshold: number;
	windowSeconds: number;
	/**
	 * Ne compter que les images plutot que toute piece jointe.
	 *
	 * Le seuil porte sur les fichiers, pas sur les messages : dix images en un
	 * seul envoi comptent pour dix. Sans cela, un spam d'images passerait sous
	 * `SPAM_RATE`, qui ne voit qu'un message.
	 */
	imagesOnly: boolean;
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
	/** Mots interdits, cherches en sous-chaine et sans tenir compte de la casse. */
	words: string[];
	/**
	 * Expressions regulieres, pour ce qu'une liste de mots ne sait pas dire
	 * (variantes, caracteres substitues, formats).
	 *
	 * Evaluees sans distinction de casse. Elles sont **compilees a
	 * l'enregistrement** par l'API : une expression invalide est refusee la,
	 * plutot que de casser silencieusement a chaque message. Leur nombre et
	 * leur longueur sont bornes, et les formes a explosion combinatoire
	 * (`(a+)+`) sont rejetees — une seule suffirait a figer le bot pour tout le
	 * serveur.
	 */
	patterns?: string[];
}

/** Bornes du filtre de mots, partagees par le formulaire et l'API. */
export const MAX_WORD_FILTER_WORDS = 500;
export const MAX_WORD_FILTER_PATTERNS = 25;
export const MAX_WORD_FILTER_PATTERN_LENGTH = 200;

/**
 * Quantificateur imbrique : `(a+)+`, `(a*)*`, `(\d+)+`...
 *
 * C'est la forme qui provoque un retour arriere catastrophique — le temps
 * d'evaluation explose sur une chaine un peu longue qui ne correspond pas. Le
 * bot n'ayant aucun moyen d'interrompre une expression partie trop loin, elle
 * est refusee a la saisie.
 */
const NESTED_QUANTIFIER = /\([^()]*[+*]\s*\)\s*[+*]/;

export interface PatternIssue {
	pattern: string;
	reason: string;
}

/**
 * Verifie une liste d'expressions. Renvoie les refus, vide si tout passe.
 *
 * Partage par l'API (qui fait foi) et par le formulaire, pour que le
 * dashboard refuse la meme chose que le serveur, avant l'aller-retour.
 */
export function validateWordFilterPatterns(patterns: readonly string[]): PatternIssue[] {
	const issues: PatternIssue[] = [];

	for (const pattern of patterns) {
		if (pattern.length > MAX_WORD_FILTER_PATTERN_LENGTH) {
			issues.push({
				pattern,
				reason: `plus de ${MAX_WORD_FILTER_PATTERN_LENGTH} caractères`,
			});
			continue;
		}

		if (NESTED_QUANTIFIER.test(pattern)) {
			issues.push({
				pattern,
				reason: "quantificateur imbriqué : risque de blocage du bot",
			});
			continue;
		}

		try {
			new RegExp(pattern, "iu");
		} catch {
			issues.push({ pattern, reason: "expression régulière invalide" });
		}
	}

	return issues;
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
	| AttachmentSpamSettings
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
	ATTACHMENT_SPAM: { attachmentThreshold: 5, windowSeconds: 15, imagesOnly: true },
	MASS_MENTIONS: { mentionThreshold: 5 },
	LINKS_INVITES: { blockLinks: false, blockInvites: true, allowedDomains: [] },
	WORD_FILTER: { words: [] },
	EXCESSIVE_CAPS: { minLength: 10, capsRatio: 0.7 },
	REPETITION: { maxRepeatedChars: 6, maxDuplicateMessages: 3 },
};

/** Exclusion temporaire de cinq minutes, duree par defaut d'une regle de flux. */
export const DEFAULT_SPAM_TIMEOUT_SECONDS = 5 * 60;

/**
 * Action pre-selectionnee dans le formulaire d'une regle jamais enregistree.
 *
 * Les deux regles de flux (`SPAM_RATE`, `ATTACHMENT_SPAM`) arrivent reglees sur
 * l'exclusion temporaire : seules elles decrivent une inondation, ou supprimer
 * les messages sans faire taire la source revient a courir derriere. Les autres
 * restent en journalisation, le temps que le serveur constate ce qu'elles
 * attraperaient avant de leur laisser supprimer quoi que ce soit.
 *
 * Une regle reste desactivee par defaut dans tous les cas : ceci ne decrit que
 * l'etat du formulaire, jamais un comportement actif sans decision explicite.
 */
export const DEFAULT_AUTOMOD_ACTIONS: Record<
	AutomodRuleType,
	{ action: AutomodAction; timeoutSeconds: number | null }
> = {
	SPAM_RATE: {
		action: AutomodAction.DELETE_AND_TIMEOUT,
		timeoutSeconds: DEFAULT_SPAM_TIMEOUT_SECONDS,
	},
	ATTACHMENT_SPAM: {
		action: AutomodAction.DELETE_AND_TIMEOUT,
		timeoutSeconds: DEFAULT_SPAM_TIMEOUT_SECONDS,
	},
	MASS_MENTIONS: { action: AutomodAction.LOG_ONLY, timeoutSeconds: null },
	LINKS_INVITES: { action: AutomodAction.LOG_ONLY, timeoutSeconds: null },
	WORD_FILTER: { action: AutomodAction.LOG_ONLY, timeoutSeconds: null },
	EXCESSIVE_CAPS: { action: AutomodAction.LOG_ONLY, timeoutSeconds: null },
	REPETITION: { action: AutomodAction.LOG_ONLY, timeoutSeconds: null },
};
