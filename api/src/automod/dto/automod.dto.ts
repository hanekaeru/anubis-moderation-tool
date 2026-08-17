import {
	IsArray,
	IsBoolean,
	IsIn,
	IsInt,
	IsObject,
	IsOptional,
	Matches,
	Max,
	Min,
} from "class-validator";
import { AutomodAction, AutomodRuleType } from "@anubis/shared";
import { PaginationDto } from "../../common/dto/pagination.dto";

const SNOWFLAKE = /^\d{17,20}$/;
const MAX_TIMEOUT_SECONDS = 28 * 24 * 60 * 60;

export class UpdateAutomodRuleDto {
	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	@IsOptional()
	@IsIn(Object.values(AutomodAction))
	action?: AutomodAction;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(MAX_TIMEOUT_SECONDS)
	timeoutSeconds?: number;

	/** Forme dependante du type de regle, validee cote applicatif plutot que champ par champ. */
	@IsOptional()
	@IsObject()
	settings?: Record<string, unknown>;

	@IsOptional()
	@IsArray()
	@Matches(SNOWFLAKE, { each: true })
	exemptRoleIds?: string[];
}

export class AutomodIncidentQueryDto extends PaginationDto {
	@IsOptional()
	@IsIn(Object.values(AutomodRuleType))
	ruleType?: AutomodRuleType;

	@IsOptional()
	@Matches(SNOWFLAKE)
	userId?: string;
}
