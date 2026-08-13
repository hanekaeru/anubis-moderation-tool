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
} from "class-validator";
import { SanctionStatus, SanctionType, WarningSeverity } from "@anubis/shared";
import { PaginationDto, ToBoolean } from "../../common/dto/pagination.dto";

const SNOWFLAKE = /^\d{17,20}$/;

export class CreateWarningDto {
	@Matches(SNOWFLAKE, { message: "userId doit etre un identifiant Discord." })
	userId!: string;

	@IsString()
	@MinLength(3, { message: "Le motif doit faire au moins 3 caracteres." })
	@MaxLength(1000)
	reason!: string;

	@IsIn(Object.values(WarningSeverity))
	severity: WarningSeverity = "LOW";

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	points: number = 1;

	@IsOptional()
	@IsDateString()
	expiresAt?: string | null;
}

export class CreateSanctionDto {
	@Matches(SNOWFLAKE, { message: "userId doit etre un identifiant Discord." })
	userId!: string;

	@IsIn(Object.values(SanctionType))
	type!: SanctionType;

	@IsString()
	@MinLength(3, { message: "Le motif doit faire au moins 3 caracteres." })
	@MaxLength(1000)
	reason!: string;

	@IsOptional()
	@IsBoolean()
	isApplied?: boolean | null;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(60, { message: "La duree minimale est de 60 secondes." })
	durationSeconds?: number | null;

	@IsOptional()
	@IsUUID()
	warningId?: string | null;

	@IsOptional()
	@IsUrl({}, { message: "evidenceUrl doit etre une URL valide." })
	@MaxLength(500)
	evidenceUrl?: string | null;
}

export class RevokeDto {
	@IsString()
	@MinLength(3, { message: "Le motif de revocation est obligatoire." })
	@MaxLength(500)
	reason!: string;
}

export class WarningQueryDto extends PaginationDto {
	@IsOptional()
	@Matches(SNOWFLAKE)
	userId?: string;

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
	@Matches(SNOWFLAKE, { message: "userId doit etre un identifiant Discord." })
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
