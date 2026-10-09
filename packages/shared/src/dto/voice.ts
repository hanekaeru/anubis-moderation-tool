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
export const DEFAULT_VOICE_STATUS_PATTERN = "{rang} {plateforme} · {roles}";

/** Plafond Discord du sujet d'un salon vocal. */
export const MAX_VOICE_STATUS_LENGTH = 500;

/**
 * Roles d'une composition d'equipe, dans l'ordre ou ils s'affichent.
 *
 * Trois valeurs figees : ce sont celles du jeu, pas un reglage. Les **places**
 * de chaque role, elles, se reglent par salon de creation — un 5v5 ne porte
 * qu'un tank la ou un 6v6 en porte deux.
 */
export const VoiceTeamRole = {
	TANK: "tank",
	DPS: "dps",
	SUPPORT: "support",
} as const;
export type VoiceTeamRole = (typeof VoiceTeamRole)[keyof typeof VoiceTeamRole];

export const VOICE_TEAM_ROLE_LABELS: Record<VoiceTeamRole, string> = {
	tank: "Tank",
	dps: "DPS",
	support: "Support",
};

/**
 * Emojis de repli des roles.
 *
 * Un serveur qui a ses propres emojis les renseigne par salon de creation ;
 * ceux-ci servent tant que rien n'est pose, pour qu'un sujet reste lisible
 * sans configuration prealable.
 */
export const DEFAULT_VOICE_TEAM_EMOJIS: Record<VoiceTeamRole, string> = {
	tank: "🛡️",
	dps: "⚔️",
	support: "💉",
};

/** Composition par defaut d'un salon de creation : un 6v6. */
export const DEFAULT_VOICE_TEAM_SLOTS: Record<VoiceTeamRole, number> = {
	tank: 2,
	dps: 2,
	support: 2,
};

/** Places par role : au-dela, ce n'est plus une composition d'equipe. */
export const MAX_VOICE_TEAM_SLOTS = 12;

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
	/** `{rang}`, `{plateforme}` et `{roles}` y sont remplaces. */
	statusPattern: string;
	/** Places de chaque role : le « sur combien » du sujet. 0 retire le role. */
	tankSlots: number;
	dpsSlots: number;
	supportSlots: number;
	/** Emoji de chaque role, `null` pour celui de repli de `@anubis/shared`. */
	tankEmoji: string | null;
	dpsEmoji: string | null;
	supportEmoji: string | null;
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

/** Reglages de composition, communs a la creation et a la mise a jour. */
export interface VoiceTeamCompositionRequest {
	tankSlots?: number;
	dpsSlots?: number;
	supportSlots?: number;
	tankEmoji?: string | null;
	dpsEmoji?: string | null;
	supportEmoji?: string | null;
}

export interface CreateVoiceHubRequest extends VoiceTeamCompositionRequest {
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

export interface UpdateVoiceHubRequest extends VoiceTeamCompositionRequest {
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

/** Un role de la composition tel qu'il s'ecrit : emoji, places prises, total. */
export interface VoiceTeamSlot {
	emoji: string;
	taken: number;
	total: number;
}

export interface VoiceStatusContext {
	rank?: VoiceStatusOption | null;
	platform?: VoiceStatusOption | null;
	/** `null` tant que le proprietaire n'a pas renseigne la composition. */
	team?: Record<VoiceTeamRole, VoiceTeamSlot> | null;
}

/** Ce que porte un salon de creation pour composer la ligne des roles. */
export interface VoiceTeamComposition {
	tankSlots: number;
	dpsSlots: number;
	supportSlots: number;
	tankEmoji: string | null;
	dpsEmoji: string | null;
	supportEmoji: string | null;
}

/** Places declarees par le proprietaire, `null` tant qu'il n'a rien declare. */
export interface VoiceTeamTaken {
	tankTaken: number | null;
	dpsTaken: number | null;
	supportTaken: number | null;
}

/**
 * Compose la ligne des roles a partir du salon de creation et des places
 * declarees.
 *
 * Partagee entre le bot (qui pousse le sujet) et le dashboard (qui le
 * previsualise), pour la meme raison que `renderVoiceStatus` : recopiee aux
 * deux endroits, elle finirait par diverger.
 *
 * Renvoie `null` tant qu'**aucune** place n'est declaree : un salon qui vient
 * de naitre n'annonce pas une equipe vide, il n'annonce rien — exactement
 * comme il n'annonce ni rang ni plateforme avant qu'on les choisisse.
 */
export function voiceTeamSlots(
	composition: VoiceTeamComposition,
	taken: VoiceTeamTaken,
): Record<VoiceTeamRole, VoiceTeamSlot> | null {
	if (
		taken.tankTaken === null &&
		taken.dpsTaken === null &&
		taken.supportTaken === null
	) {
		return null;
	}

	return {
		tank: {
			emoji: composition.tankEmoji || DEFAULT_VOICE_TEAM_EMOJIS.tank,
			taken: taken.tankTaken ?? 0,
			total: composition.tankSlots,
		},
		dps: {
			emoji: composition.dpsEmoji || DEFAULT_VOICE_TEAM_EMOJIS.dps,
			taken: taken.dpsTaken ?? 0,
			total: composition.dpsSlots,
		},
		support: {
			emoji: composition.supportEmoji || DEFAULT_VOICE_TEAM_EMOJIS.support,
			taken: taken.supportTaken ?? 0,
			total: composition.supportSlots,
		},
	};
}

function formatOption(option?: VoiceStatusOption | null): string {
	if (!option) return "";
	return option.emoji ? `${option.emoji} ${option.label}` : option.label;
}

/**
 * L'option reduite a son icone, pour les gabarits qui manquent de place.
 *
 * **Repli sur le libelle quand l'option n'a pas d'emoji.** Rendre vide serait
 * la seule lecture coherente avec le nom du jeton, mais elle ferait disparaitre
 * le rang du sujet sans que personne ne comprenne pourquoi : l'information
 * compte plus que la promesse de compacite. Le dashboard signale les options
 * sans emoji pour que le cas se corrige a la source.
 */
function formatOptionIcone(option?: VoiceStatusOption | null): string {
	if (!option) return "";
	return option.emoji || option.label;
}

/**
 * « 🛡️ 1/2 · ⚔️ 2/2 · 💉 2/2 ».
 *
 * Un role sans aucune place dans la composition est **omis** : un salon de
 * creation regle sur 0 tank ne doit pas afficher « 0/0 », qui se lirait comme
 * une equipe complete.
 */
function formatTeam(team?: Record<VoiceTeamRole, VoiceTeamSlot> | null): string {
	if (!team) return "";

	return Object.values(VoiceTeamRole)
		.map((role) => team[role])
		.filter((slot) => slot.total > 0)
		.map((slot) => `${slot.emoji} ${slot.taken}/${slot.total}`)
		.join(" · ");
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
 *
 * Chaque option existe en **deux jetons** : `{rang}` rend « 🥇 Or » et
 * `{rang-icone}` rend « 🥇 ». Le sujet d'un salon vocal est court et Discord le
 * tronque sans prevenir ; pouvoir retirer les libelles sans renoncer a
 * l'information est ce qui permet d'y faire tenir la composition d'equipe.
 * Les deux formes se melangent — rien n'empeche « 🥇 Or » suivi de la seule
 * icone de plateforme — et l'ordre reste celui du gabarit.
 *
 * `{sujet}` est accepte et rendu vide : c'est l'ancien texte libre, retire
 * parce qu'il invitait au debordement. La migration a reecrit les gabarits
 * existants, mais le champ reste modifiable a la main depuis le dashboard.
 */
export function renderVoiceStatus(
	pattern: string,
	context: VoiceStatusContext,
): string {
	const rendered = pattern
		.replaceAll("{rang-icone}", formatOptionIcone(context.rank))
		.replaceAll("{plateforme-icone}", formatOptionIcone(context.platform))
		.replaceAll("{rang}", formatOption(context.rank))
		.replaceAll("{plateforme}", formatOption(context.platform))
		.replaceAll("{roles}", formatTeam(context.team))
		.replaceAll("{sujet}", "");

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
