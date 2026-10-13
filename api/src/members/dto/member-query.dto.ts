import { Type } from "class-transformer";
import {
	ArrayMaxSize,
	ArrayNotEmpty,
	IsArray,
	IsBoolean,
	IsDateString,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	Min,
} from "class-validator";
import {
	MemberStatus,
	TimelineKind,
	type MemberSortField,
} from "@anubis/shared";
import { PaginationDto, ToBoolean } from "../../common/dto/pagination.dto";

const MEMBER_SORT_FIELDS: MemberSortField[] = [
	"username",
	"joinedAt",
	"warningCount",
	"messageCount30d",
	"lastActiveAt",
];

export class MemberQueryDto extends PaginationDto {
	@IsOptional()
	@IsString()
	@MaxLength(100)
	search?: string;

	@IsOptional()
	@IsIn(Object.values(MemberStatus))
	status?: MemberStatus;

	@IsOptional()
	@Matches(/^\d{17,20}$/, {
		message: "roleId doit être un identifiant Discord.",
	})
	roleId?: string;

	@IsOptional()
	@ToBoolean()
	@IsBoolean()
	hasActiveSanction?: boolean;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	minWarnings?: number;

	@IsOptional()
	@IsDateString()
	joinedAfter?: string;

	@IsOptional()
	@IsDateString()
	joinedBefore?: string;

	@IsOptional()
	@IsIn(MEMBER_SORT_FIELDS)
	sortBy: MemberSortField = "username";

	@IsOptional()
	@IsIn(["asc", "desc"])
	sortDir: "asc" | "desc" = "asc";
}

export class UpdateRoleSettingsDto {
	@IsOptional()
	@IsBoolean()
	trackHistory?: boolean;

	@IsOptional()
	@IsBoolean()
	separator?: boolean;
}

/**
 * Plafond d'une demande : Discord n'impose rien de tel, mais un serveur n'a
 * guere plus d'une dizaine de separateurs, et la borne evite qu'une requete
 * forgee n'envoie au bot une liste sans fin.
 */
const MAX_SEPARATORS_PER_REQUEST = 25;

export class AddMemberSeparatorsDto {
	@IsArray()
	@ArrayNotEmpty({ message: "Choisissez au moins un séparateur." })
	@ArrayMaxSize(MAX_SEPARATORS_PER_REQUEST)
	@Matches(/^\d{17,20}$/, { each: true, message: "Identifiant de rôle invalide." })
	roleIds!: string[];
}

/** Aucun filtre pour l'instant : seule la pagination compte. */
export class VoiceSessionQueryDto extends PaginationDto {}

export class TimelineQueryDto extends PaginationDto {
	@IsOptional()
	@IsString({ each: true })
	@IsIn(Object.values(TimelineKind), { each: true })
	@Type(() => String)
	kinds?: TimelineKind[];

	@IsOptional()
	@IsDateString()
	from?: string;

	@IsOptional()
	@IsDateString()
	to?: string;
}
