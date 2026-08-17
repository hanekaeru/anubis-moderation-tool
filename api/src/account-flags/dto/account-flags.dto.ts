import { IsOptional, Matches } from "class-validator";
import { PaginationDto, ToBoolean } from "../../common/dto/pagination.dto";

const SNOWFLAKE = /^\d{17,20}$/;

export class AccountFlagQueryDto extends PaginationDto {
	@IsOptional()
	@Matches(SNOWFLAKE)
	userId?: string;

	@IsOptional()
	@ToBoolean()
	reviewed?: boolean;
}
