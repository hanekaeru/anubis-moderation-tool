import {
	DEFAULT_MODERATION_POINTS,
	INSTANT_SANCTION_TYPES,
	type ModerationPointsConfigDto,
} from "./dto/moderation";
import type { SanctionStatus, SanctionType } from "./enums";

/**
 * Regles de moderation communes a l'API (sanction posee depuis le dashboard)
 * et au bot (commande Discord, automod, ingestion du journal d'audit).
 *
 * Elles etaient recopiees a trois endroits : une regle ajoutee a l'un et
 * oubliee ailleurs aurait fait qu'une meme sanction n'expire pas, ou ne pese
 * pas, de la meme facon selon d'ou elle vient. Fonctions pures, sans
 * dependance : le dashboard peut les importer aussi.
 */

/** Calendrier d'une sanction, tel qu'il s'ecrit en base. */
export interface SanctionSchedule {
	/** `null` pour une sanction instantanee, meme si une duree a ete saisie. */
	durationSeconds: number | null;
	startsAt: Date;
	expiresAt: Date | null;
	status: Extract<SanctionStatus, "ACTIVE" | "EXPIRED">;
}

/**
 * Debut, fin et statut initial d'une sanction.
 *
 * Une sanction instantanee (expulsion) prend effet et se termine dans la
 * foulee : la laisser `ACTIVE` la ferait apparaitre indefiniment comme
 * sanction en cours. Elle n'a donc ni duree ni fin.
 */
export function sanctionSchedule(
	type: SanctionType,
	durationSeconds: number | null | undefined,
	startsAt: Date = new Date(),
): SanctionSchedule {
	const instant = INSTANT_SANCTION_TYPES.includes(type);
	const duree = instant ? null : (durationSeconds ?? null);

	return {
		durationSeconds: duree,
		startsAt,
		expiresAt: duree ? new Date(startsAt.getTime() + duree * 1000) : null,
		status: instant ? "EXPIRED" : "ACTIVE",
	};
}

/**
 * Colonnes de `moderation_points_config`, decrites ici sans dependre du
 * client Prisma : ce fichier reste importable depuis le navigateur.
 */
export interface ModerationPointsRow {
	warningLowPoints: number;
	warningMediumPoints: number;
	warningHighPoints: number;
	timeoutPoints: number;
	kickPoints: number;
	banPoints: number;
	shadowbanPoints: number;
	warnThreshold: number;
	criticalThreshold: number;
}

export type ModerationPoints = Omit<ModerationPointsConfigDto, "guildId" | "updatedAt">;

/**
 * Bareme d'un serveur, a partir de sa ligne en base (`null` : jamais regle).
 *
 * La base range le bareme en colonnes nommees parce que le jeu de cles est
 * ferme et connu du schema ; le reste du code le lit en dictionnaires indexes
 * par l'enum, pour s'ecrire sans `switch`. La traduction vit **ici**, et nulle
 * part ailleurs : l'API l'expose, le bot l'applique aux sanctions posees depuis
 * Discord, et les deux doivent lire exactement le meme bareme.
 */
export function moderationPointsFromRow(row: ModerationPointsRow | null): ModerationPoints {
	if (!row) {
		return {
			warningPoints: { ...DEFAULT_MODERATION_POINTS.warningPoints },
			sanctionPoints: { ...DEFAULT_MODERATION_POINTS.sanctionPoints },
			warnThreshold: DEFAULT_MODERATION_POINTS.warnThreshold,
			criticalThreshold: DEFAULT_MODERATION_POINTS.criticalThreshold,
		};
	}

	return {
		warningPoints: {
			LOW: row.warningLowPoints,
			MEDIUM: row.warningMediumPoints,
			HIGH: row.warningHighPoints,
		},
		sanctionPoints: {
			TIMEOUT: row.timeoutPoints,
			KICK: row.kickPoints,
			BAN: row.banPoints,
			SHADOWBAN: row.shadowbanPoints,
		},
		warnThreshold: row.warnThreshold,
		criticalThreshold: row.criticalThreshold,
	};
}
