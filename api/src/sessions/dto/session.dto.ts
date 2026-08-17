import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsUUID } from "class-validator";

export class SessionQueryDto {
	@IsOptional()
	@IsUUID()
	appUserId?: string;

	// Les filtres arrivent en chaine dans l'URL : sans cette conversion,
	// `?includeInactive=false` serait une chaine non vide, donc vraie.
	@IsOptional()
	@Transform(({ value }) => value === true || value === "true")
	@IsBoolean()
	includeInactive?: boolean;
}
