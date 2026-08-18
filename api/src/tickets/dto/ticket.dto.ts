import { Type } from "class-transformer";
import {
	IsBoolean,
	IsDateString,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
	ValidateIf,
} from "class-validator";
import {
	MAX_MAX_OPEN_TICKETS,
	MIN_MAX_OPEN_TICKETS,
	TicketCategory,
	TicketPriority,
	TicketStatus,
} from "@anubis/shared";
import { PaginationDto } from "../../common/dto/pagination.dto";

const SNOWFLAKE = /^\d{17,20}$/;

export class TicketQueryDto extends PaginationDto {
	@IsOptional()
	@IsString()
	@MaxLength(100)
	search?: string;

	@IsOptional()
	@IsIn(Object.values(TicketStatus))
	status?: TicketStatus;

	@IsOptional()
	@IsIn(Object.values(TicketPriority))
	priority?: TicketPriority;

	@IsOptional()
	@IsIn(Object.values(TicketCategory))
	category?: TicketCategory;

	@IsOptional()
	@Matches(SNOWFLAKE)
	assigneeId?: string;

	@IsOptional()
	@Matches(SNOWFLAKE)
	openerId?: string;

	@IsOptional()
	@IsDateString()
	from?: string;

	@IsOptional()
	@IsDateString()
	to?: string;

	@IsOptional()
	@IsIn(["openedAt", "closedAt", "priority", "number"])
	sortBy: "openedAt" | "closedAt" | "priority" | "number" = "openedAt";

	@IsOptional()
	@IsIn(["asc", "desc"])
	sortDir: "asc" | "desc" = "desc";
}

export class UpdateTicketDto {
	@IsOptional()
	@IsIn(Object.values(TicketStatus))
	status?: TicketStatus;

	@IsOptional()
	@IsIn(Object.values(TicketPriority))
	priority?: TicketPriority;

	@IsOptional()
	@IsIn(Object.values(TicketCategory))
	category?: TicketCategory;

	// `null` est une valeur utile ici : elle desassigne le ticket.
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE)
	assigneeId?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	closeReason?: string;
}

export class AddTicketNoteDto {
	@IsString()
	@MinLength(1)
	@MaxLength(4000)
	body!: string;
}

/** Libelle affiche dans le select de la modale Discord. */
const SUBJECT_LABEL_MAX = 80;

/** Description d'option : Discord la tronque a 100 caracteres. */
const SUBJECT_DESCRIPTION_MAX = 100;

const EMOJI_MAX = 64;

export class CreateTicketSubjectDto {
	@IsString()
	@MinLength(1)
	@MaxLength(SUBJECT_LABEL_MAX)
	label!: string;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(SUBJECT_DESCRIPTION_MAX)
	description?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(EMOJI_MAX)
	emoji?: string | null;

	@IsOptional()
	@IsIn(Object.values(TicketCategory))
	category?: TicketCategory;

	@IsOptional()
	@IsIn(Object.values(TicketPriority))
	defaultPriority?: TicketPriority;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	@Max(1000)
	position?: number;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;
}

export class UpdateTicketSubjectDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(SUBJECT_LABEL_MAX)
	label?: string;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(SUBJECT_DESCRIPTION_MAX)
	description?: string | null;

	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@IsString()
	@MaxLength(EMOJI_MAX)
	emoji?: string | null;

	@IsOptional()
	@IsIn(Object.values(TicketCategory))
	category?: TicketCategory;

	@IsOptional()
	@IsIn(Object.values(TicketPriority))
	defaultPriority?: TicketPriority;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	@Max(1000)
	position?: number;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;
}

export class UpsertTicketPrefixDto {
	/**
	 * Longueur genereuse a la saisie : la normalisation cote service coupe au
	 * plafond reel, apres avoir retire ce que Discord n'accepte pas.
	 */
	@IsString()
	@MinLength(1)
	@MaxLength(40)
	prefix!: string;
}

export class UpdateTicketConfigDto {
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(MIN_MAX_OPEN_TICKETS)
	@Max(MAX_MAX_OPEN_TICKETS)
	maxOpenTickets?: number;
}
