import { Type } from "class-transformer";
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsBoolean,
	IsDateString,
	IsIn,
	IsInt,
	IsObject,
	IsOptional,
	IsString,
	IsUrl,
	IsUUID,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
	ValidateIf,
} from "class-validator";
import {
	ESPORT_REGION_CODES,
	EsportMatchFormat,
	MAX_ESPORT_MATCHES_PER_WEEK,
	MAX_ESPORT_SCORE,
} from "@anubis/shared";

const SNOWFLAKE = /^\d{17,20}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const URL_OPTIONS = { protocols: ["http", "https"], require_protocol: true };

/**
 * `null` est une valeur utile pour chaque champ facultatif : il detache un
 * salon ou un role, ou efface un texte. Meme convention que `UpdateXpConfigDto`.
 */
export class UpdateEsportConfigDto {
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE, { message: "Identifiant de salon invalide." })
	channelId?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE, { message: "Identifiant de salon invalide." })
	resultsChannelId?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE, { message: "Identifiant de rôle invalide." })
	mentionRoleId?: string | null;

	@IsOptional()
	@IsBoolean()
	mentionOnPublish?: boolean;

	@IsOptional()
	@IsBoolean()
	mentionOnResult?: boolean;

	@IsOptional()
	@IsBoolean()
	spoilerScores?: boolean;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(0xffffff)
	color?: number;

	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(200)
	title?: string;

	/**
	 * Remplace la liste entiere ; `[]` coupe l'import sans retirer la cle. Les
	 * crochets et la barre verticale sont refuses : la valeur part telle quelle
	 * dans une condition Liquipedia (`[[series::…]]`).
	 */
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(10)
	@IsString({ each: true })
	@MaxLength(200, { each: true })
	@Matches(/^[^[\]|]+$/, { each: true, message: "Nom de série Liquipedia invalide." })
	liquipediaSeries?: string[];

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(20)
	@IsString({ each: true })
	@MaxLength(60, { each: true })
	liquipediaKeywords?: string[];

	@IsOptional()
	@IsBoolean()
	liquipediaFirstTo?: boolean;

	/** `{ code de region: couleur }` ; codes et valeurs verifies par le service. */
	@IsOptional()
	@IsObject()
	regionColors?: Record<string, number>;
}

export class EsportImportDtoIn {
	@IsArray()
	@ArrayMinSize(1, { message: "Choisissez au moins un match à importer." })
	@ArrayMaxSize(MAX_ESPORT_MATCHES_PER_WEEK)
	@IsString({ each: true })
	@MinLength(1, { each: true })
	@MaxLength(100, { each: true })
	ids!: string[];
}

export class EsportTeamDtoIn {
	@IsString()
	@MinLength(1, { message: "Le nom de l'équipe est requis." })
	@MaxLength(80)
	name!: string;

	/** Unicode ou `<:nom:id>` ; la forme exacte est laissee a Discord. */
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(100)
	emoji?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsUrl(URL_OPTIONS, { message: "Le logo doit être une adresse http(s)." })
	@MaxLength(500)
	logoUrl?: string | null;

	@IsOptional()
	@IsBoolean()
	highlighted?: boolean;
}

export class CreateEsportWeekDto {
	@Matches(DATE_KEY, { message: "Date attendue au format AAAA-MM-JJ." })
	weekStart!: string;
}

export class UpdateEsportWeekDto {
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(200)
	title?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(1000)
	description?: string | null;
}

export class EsportMatchDtoIn {
	/** `null` : adversaire encore a determiner. */
	@ValidateIf((_, value) => value !== null)
	@IsUUID()
	teamAId!: string | null;

	@ValidateIf((_, value) => value !== null)
	@IsUUID()
	teamBId!: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(120)
	competition?: string | null;

	@IsDateString()
	scheduledAt!: string;

	@IsOptional()
	@IsIn(Object.values(EsportMatchFormat))
	format?: EsportMatchFormat;

	/** Code de `ESPORT_REGIONS` ; `null` pour un match sans region. */
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsIn(ESPORT_REGION_CODES, { message: "Région inconnue." })
	region?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(9)
	bestOf?: number | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsUrl(URL_OPTIONS, { message: "Le lien du stream doit être une adresse http(s)." })
	@MaxLength(500)
	streamUrl?: string | null;
}

export class EsportResultDtoIn {
	@IsInt()
	@Min(0)
	@Max(MAX_ESPORT_SCORE)
	scoreA!: number;

	@IsInt()
	@Min(0)
	@Max(MAX_ESPORT_SCORE)
	scoreB!: number;

	@ValidateIf((_, value) => value !== null)
	@IsBoolean()
	spoiler!: boolean | null;

	@IsBoolean()
	announce!: boolean;
}
