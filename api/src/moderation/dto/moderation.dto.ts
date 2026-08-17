import { Type } from "class-transformer";
import {
	IsBoolean,
	IsDateString,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	IsUrl,
	IsUUID,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
	ValidateNested,
} from "class-validator";
import {
	MAX_MODERATION_POINTS,
	MAX_MODERATION_THRESHOLD,
	MIN_MODERATION_POINTS,
	SanctionStatus,
	SanctionType,
	WarningSeverity,
} from "@anubis/shared";
import { PaginationDto, ToBoolean } from "../../common/dto/pagination.dto";

const SNOWFLAKE = /^\d{17,20}$/;

export class CreateWarningDto {
	@Matches(SNOWFLAKE, { message: "userId doit être un identifiant Discord." })
	userId!: string;

	@IsString()
	@MinLength(3, { message: "Le motif doit faire au moins 3 caractères." })
	@MaxLength(1000)
	reason!: string;

	@IsIn(Object.values(WarningSeverity))
	severity: WarningSeverity = "LOW";

	/**
	 * Absent = valeur du bareme pour cette gravite.
	 *
	 * Pas de valeur par defaut ici : un `= 1` code en dur reprendrait toujours
	 * le dessus sur le bareme du serveur, que le formulaire envoie le champ ou
	 * non.
	 */
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(MIN_MODERATION_POINTS)
	@Max(MAX_MODERATION_POINTS)
	points?: number;

	@IsOptional()
	@IsDateString()
	expiresAt?: string | null;
}

export class CreateSanctionDto {
	@Matches(SNOWFLAKE, { message: "userId doit être un identifiant Discord." })
	userId!: string;

	@IsIn(Object.values(SanctionType))
	type!: SanctionType;

	@IsString()
	@MinLength(3, { message: "Le motif doit faire au moins 3 caractères." })
	@MaxLength(1000)
	reason!: string;

	@IsOptional()
	@IsBoolean()
	isApplied?: boolean | null;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(60, { message: "La durée minimale est de 60 secondes." })
	durationSeconds?: number | null;

	@IsOptional()
	@IsUUID()
	warningId?: string | null;

	@IsOptional()
	@IsUrl({}, { message: "evidenceUrl doit être une URL valide." })
	@MaxLength(500)
	evidenceUrl?: string | null;

	/** Absent = valeur du bareme pour ce type de sanction. */
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(MIN_MODERATION_POINTS)
	@Max(MAX_MODERATION_POINTS)
	points?: number;
}

class WarningPointsDto {
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(MIN_MODERATION_POINTS)
	@Max(MAX_MODERATION_POINTS)
	LOW?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(MIN_MODERATION_POINTS)
	@Max(MAX_MODERATION_POINTS)
	MEDIUM?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(MIN_MODERATION_POINTS)
	@Max(MAX_MODERATION_POINTS)
	HIGH?: number;
}

class SanctionPointsDto {
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(MIN_MODERATION_POINTS)
	@Max(MAX_MODERATION_POINTS)
	TIMEOUT?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(MIN_MODERATION_POINTS)
	@Max(MAX_MODERATION_POINTS)
	KICK?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(MIN_MODERATION_POINTS)
	@Max(MAX_MODERATION_POINTS)
	BAN?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(MIN_MODERATION_POINTS)
	@Max(MAX_MODERATION_POINTS)
	SHADOWBAN?: number;
}

export class UpdateModerationPointsDto {
	@IsOptional()
	@ValidateNested()
	@Type(() => WarningPointsDto)
	warningPoints?: WarningPointsDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => SanctionPointsDto)
	sanctionPoints?: SanctionPointsDto;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(MAX_MODERATION_THRESHOLD)
	warnThreshold?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(MAX_MODERATION_THRESHOLD)
	criticalThreshold?: number;
}

export class RevokeDto {
	@IsString()
	@MinLength(3, { message: "Le motif de révocation est obligatoire." })
	@MaxLength(500)
	reason!: string;
}

export class WarningQueryDto extends PaginationDto {
	@IsOptional()
	@Matches(SNOWFLAKE)
	userId?: string;

	/** Recherche libre sur le membre : pseudo, nom affiché ou identifiant. */
	@IsOptional()
	@IsString()
	@MaxLength(100)
	member?: string;

	@IsOptional()
	@IsIn(Object.values(WarningSeverity))
	severity?: WarningSeverity;

	@IsOptional()
	@ToBoolean()
	@IsBoolean()
	activeOnly?: boolean;

	@IsOptional()
	@IsDateString()
	from?: string;

	@IsOptional()
	@IsDateString()
	to?: string;
}

export class SanctionQueryDto extends PaginationDto {
	@IsOptional()
	@Matches(SNOWFLAKE)
	userId?: string;

	/** Recherche libre sur le membre : pseudo, nom affiché ou identifiant. */
	@IsOptional()
	@IsString()
	@MaxLength(100)
	member?: string;

	@IsOptional()
	@IsIn(Object.values(SanctionType))
	type?: SanctionType;

	@IsOptional()
	@IsIn(Object.values(SanctionStatus))
	status?: SanctionStatus;

	@IsOptional()
	@IsDateString()
	from?: string;

	@IsOptional()
	@IsDateString()
	to?: string;
}

export class CreateNoteDto {
	@Matches(SNOWFLAKE, { message: "userId doit être un identifiant Discord." })
	userId!: string;

	@IsString()
	@MinLength(1)
	@MaxLength(4000)
	body!: string;

	@IsOptional()
	@IsBoolean()
	pinned?: boolean;
}

export class UpdateNoteDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(4000)
	body?: string;

	@IsOptional()
	@IsBoolean()
	pinned?: boolean;
}
