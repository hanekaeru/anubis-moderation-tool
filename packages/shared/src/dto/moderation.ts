import {
	AutomodRuleType,
	SanctionStatus,
	SanctionType,
	WarningSeverity,
} from "../enums";
import { IsoDateString, PaginationQuery, Snowflake } from "./common";

/** Reference courte vers un membre, pour ne pas dupliquer la fiche complete. */
export interface MemberRef {
	userId: Snowflake;
	username: string;
	globalName: string | null;
	avatarUrl: string | null;
}

/** Auteur d'une action : soit un moderateur Discord, soit un compte dashboard. */
export interface ActorRef {
	kind: "discord" | "app" | "system";
	id: string | null;
	label: string;
}

/**
 * Plafond par fichier, aligne sur celui des pieces jointes de tickets cote bot
 * (`MAX_ATTACHMENT_BYTES`) : deux limites differentes pour la meme table de
 * stockage se contrediraient tot ou tard.
 */
export const MAX_MODERATION_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Nombre de pieces jointes par decision, pour borner le poids d'une fiche. */
export const MAX_MODERATION_ATTACHMENTS = 5;

/**
 * Types acceptes pour une preuve.
 *
 * Liste blanche plutot que liste noire : le fichier est resservi tel quel par
 * l'API, et laisser passer un `text/html` ouvrirait une execution de script sur
 * le domaine du dashboard.
 *
 * Elle vit ici parce que trois chemins de depot la verifient — l'API (qui fait
 * foi), le formulaire du dashboard et la commande `/preuve` du bot. Trois
 * copies finiraient par diverger, et un fichier accepte par le bot puis refuse
 * par l'API serait perdu apres son telechargement.
 */
export const MODERATION_ATTACHMENT_CONTENT_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"video/mp4",
	"video/webm",
	"audio/mpeg",
	"audio/ogg",
	"application/pdf",
	"text/plain",
] as const;

/** Metadonnees d'une piece jointe : les octets se recuperent a part. */
export interface ModerationAttachmentRef {
	id: string;
	fileName: string;
	contentType: string;
	size: number;
	/**
	 * Preuve explicite, a ne pas afficher sans un geste volontaire.
	 *
	 * Le marqueur ne restreint aucun acces — qui peut lire la decision peut
	 * lire la piece. Il evite seulement qu'une image penible s'impose a l'ecran
	 * d'un moderateur qui parcourt une fiche.
	 */
	spoiler: boolean;
	uploadedBy: ActorRef | null;
	createdAt: IsoDateString;
}

export interface WarningDto {
	id: string;
	guildId: Snowflake;
	member: MemberRef;
	issuedBy: ActorRef;
	reason: string;
	severity: WarningSeverity;
	points: number;
	expiresAt: IsoDateString | null;
	revokedAt: IsoDateString | null;
	revokedBy: ActorRef | null;
	revokeReason: string | null;
	createdAt: IsoDateString;
	/** Ni revoque, ni expire. */
	isActive: boolean;
	attachments: ModerationAttachmentRef[];
}

export interface CreateWarningRequest {
	userId: Snowflake;
	reason: string;
	severity: WarningSeverity;
	points?: number;
	expiresAt?: IsoDateString | null;
}

export interface RevokeRequest {
	reason: string;
}

export interface WarningSearchQuery extends PaginationQuery {
	userId?: Snowflake;
	/**
	 * Recherche libre sur le membre visé : pseudo, nom affiché ou identifiant.
	 *
	 * Distincte de `userId`, qui exige l'identifiant exact : le staff connait
	 * un pseudo, pas un snowflake.
	 */
	member?: string;
	severity?: WarningSeverity;
	activeOnly?: boolean;
	from?: IsoDateString;
	to?: IsoDateString;
}

/**
 * Incident d'automoderation a l'origine d'une sanction automatique.
 *
 * Le message incrimine est supprime de Discord des le declenchement : ce que
 * porte `messageContent` en est la seule trace, et c'est ce qui permet a une
 * sanction « Automod : Filtre de mots » de dire *ce qui* a ete ecrit, partout
 * ou elle s'affiche.
 */
export interface SanctionAutomodRef {
	incidentId: string;
	ruleType: AutomodRuleType;
	/** Contenu du message supprime ; `null` si le message n'avait pas de texte. */
	messageContent: string | null;
	/** Mot ou expression qui a declenche la regle, quand la regle en designe un. */
	matched: string | null;
	channelId: Snowflake | null;
	occurredAt: IsoDateString;
}

export interface SanctionDto {
	id: string;
	guildId: Snowflake;
	member: MemberRef;
	issuedBy: ActorRef;
	type: SanctionType;
	status: SanctionStatus;
	reason: string;
	durationSeconds: number | null;
	startsAt: IsoDateString;
	expiresAt: IsoDateString | null;
	revokedAt: IsoDateString | null;
	revokedBy: ActorRef | null;
	revokeReason: string | null;
	/** Renseigne quand la sanction vient de l'automoderation, `null` sinon. */
	automod: SanctionAutomodRef | null;
	warningId: string | null;
	/** Permalien vers le message incrimine : complementaire des pieces jointes. */
	evidenceUrl: string | null;
	createdAt: IsoDateString;
	attachments: ModerationAttachmentRef[];
	/** Poids dans le score du membre, fige a la creation. */
	points: number;
}

export interface CreateSanctionRequest {
	userId: Snowflake;
	type: SanctionType;
	reason: string;
	/** Null ou absent = sanction permanente. */
	isApplied?: boolean | null;
	durationSeconds?: number | null;
	warningId?: string | null;
	evidenceUrl?: string | null;
	/** Absent = valeur du bareme pour ce type de sanction. */
	points?: number;
}

export interface SanctionSearchQuery extends PaginationQuery {
	userId?: Snowflake;
	/** Voir `WarningSearchQuery.member`. */
	member?: string;
	type?: SanctionType;
	status?: SanctionStatus;
	from?: IsoDateString;
	to?: IsoDateString;
}

export interface NoteDto {
	id: string;
	guildId: Snowflake;
	userId: Snowflake;
	author: ActorRef;
	body: string;
	pinned: boolean;
	createdAt: IsoDateString;
	updatedAt: IsoDateString;
	/** Vrai si le compte connecte peut modifier ou supprimer cette note. */
	canEdit: boolean;
}

export interface CreateNoteRequest {
	userId: Snowflake;
	body: string;
	pinned?: boolean;
}

export interface UpdateNoteRequest {
	body?: string;
	pinned?: boolean;
}

/** Durees proposees dans les formulaires de sanction, en secondes. */
export const SANCTION_DURATION_PRESETS: ReadonlyArray<{
	label: string;
	seconds: number | null;
}> = [
		{ label: "60 secondes", seconds: 60 },
		{ label: "5 minutes", seconds: 5 * 60 },
		{ label: "10 minutes", seconds: 10 * 60 },
		{ label: "1 heure", seconds: 60 * 60 },
		{ label: "1 jour", seconds: 24 * 60 * 60 },
		{ label: "1 semaine", seconds: 7 * 24 * 60 * 60 },
		{ label: "28 jours", seconds: 28 * 24 * 60 * 60 },
		{ label: "Permanent", seconds: null },
	];

/**
 * Discord plafonne les exclusions temporaires a 28 jours. La contrainte est
 * declaree ici pour que le formulaire et l'API l'appliquent a l'identique.
 */
export const MAX_TIMEOUT_SECONDS = 28 * 24 * 60 * 60;

/** Types de sanction qui n'ont pas de duree. */
export const INSTANT_SANCTION_TYPES: readonly SanctionType[] = ["KICK"];

// ---------------------------------------------------------------------------
// Points de moderation
// ---------------------------------------------------------------------------

/**
 * Bareme de points, par gravite d'avertissement et par type de sanction.
 *
 * Il ne fournit qu'une **valeur par defaut** : chaque avertissement et chaque
 * sanction copie son poids a la creation, puis le garde. Un bareme retroactif
 * ferait bouger tous les scores du serveur d'un seul reglage, sans que rien
 * n'apparaisse dans le journal d'audit.
 */
export interface ModerationPointsConfigDto {
	guildId: Snowflake;
	warningPoints: Record<WarningSeverity, number>;
	sanctionPoints: Record<SanctionType, number>;
	/** Score actif a partir duquel un membre est signale « a surveiller ». */
	warnThreshold: number;
	/** Score actif a partir duquel un membre est signale « problematique ». */
	criticalThreshold: number;
	updatedAt: IsoDateString;
}

export interface UpdateModerationPointsRequest {
	warningPoints?: Partial<Record<WarningSeverity, number>>;
	sanctionPoints?: Partial<Record<SanctionType, number>>;
	warnThreshold?: number;
	criticalThreshold?: number;
}

/** Bornes communes au formulaire et a la validation de l'API. */
export const MIN_MODERATION_POINTS = 0;
export const MAX_MODERATION_POINTS = 100;
export const MAX_MODERATION_THRESHOLD = 1000;

/**
 * Bareme par defaut, applique tant qu'un serveur n'a rien regle.
 *
 * L'echelle suit la gravite reelle de la mesure : un bannissement pese autant
 * que dix avertissements legers, une expulsion autant que cinq. Le shadowban
 * s'aligne sur l'expulsion — il retire l'acces sans retirer le membre.
 */
export const DEFAULT_MODERATION_POINTS: Omit<
	ModerationPointsConfigDto,
	"guildId" | "updatedAt"
> = {
	warningPoints: { LOW: 1, MEDIUM: 3, HIGH: 5 },
	sanctionPoints: { TIMEOUT: 3, KICK: 5, BAN: 10, SHADOWBAN: 5 },
	warnThreshold: 6,
	criticalThreshold: 12,
};

/** Lecture d'un score : trois paliers, pour ne pas avoir a interpreter un nombre nu. */
export const ModerationRisk = {
	CLEAN: "CLEAN",
	WATCH: "WATCH",
	CRITICAL: "CRITICAL",
} as const;
export type ModerationRisk = (typeof ModerationRisk)[keyof typeof ModerationRisk];

export const MODERATION_RISK_LABELS: Record<ModerationRisk, string> = {
	CLEAN: "Rien à signaler",
	WATCH: "À surveiller",
	CRITICAL: "Problématique",
};

/**
 * Palier correspondant a un score actif.
 *
 * Les seuils sont **inclusifs** : atteindre `criticalThreshold` suffit a
 * basculer, sans quoi le seuil affiche sur la page de reglage ne serait jamais
 * celui qui declenche. Un seuil critique mal regle sous le seuil d'alerte
 * l'emporte quand meme — la lecture la plus severe est la plus sure.
 */
export function moderationRisk(
	score: number,
	thresholds: Pick<
		ModerationPointsConfigDto,
		"warnThreshold" | "criticalThreshold"
	>,
): ModerationRisk {
	if (score >= thresholds.criticalThreshold) return ModerationRisk.CRITICAL;
	if (score >= thresholds.warnThreshold) return ModerationRisk.WATCH;
	return ModerationRisk.CLEAN;
}

/**
 * Score de moderation d'un membre : ce qui pese **en ce moment**.
 *
 * Les entrees revoquees ou expirees en sortent, pour que le score redescende
 * de lui-meme. Il repond a « ce membre pose-t-il probleme aujourd'hui », pas a
 * « a-t-il des antecedents » — la chronologie de la fiche, elle, garde tout.
 */
export interface ModerationScoreDto {
	/** Somme des points des avertissements actifs. */
	warnings: number;
	/** Somme des points des sanctions actives. */
	sanctions: number;
	total: number;
	risk: ModerationRisk;
	/** Seuils en vigueur, pour situer le total sans rappeler la configuration. */
	warnThreshold: number;
	criticalThreshold: number;
}
