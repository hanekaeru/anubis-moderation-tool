import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
} from "@nestjs/common";
import {
	Permission,
	type OwdleAffiliationDto,
	type OwdleConfigDto,
	type OwdleHeroDto,
	type OwdleOverviewDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import {
	CreateOwdleHeroDto,
	SaveOwdleAffiliationDto,
	UpdateOwdleConfigDto,
	UpdateOwdleHeroDto,
} from "./dto/owdle.dto";
import { OwdleService } from "./owdle.service";

/**
 * Pas de route de suppression : un heros se desactive. Sa cle vit dans les
 * parties enregistrees, et une partie passee doit pouvoir se relire.
 */
@Controller("owdle")
export class OwdleController {
	constructor(private readonly owdle: OwdleService) {}

	@Get()
	@RequirePermissions(Permission.OWDLE_READ)
	overview(): Promise<OwdleOverviewDto> {
		return this.owdle.overview();
	}

	@Patch("configuration")
	@RequirePermissions(Permission.OWDLE_MANAGE)
	updateConfig(
		@Body() dto: UpdateOwdleConfigDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<OwdleConfigDto> {
		return this.owdle.updateConfig(dto, actor);
	}

	@Post("heros")
	@RequirePermissions(Permission.OWDLE_MANAGE)
	createHero(
		@Body() dto: CreateOwdleHeroDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<OwdleHeroDto> {
		return this.owdle.createHero(dto, actor);
	}

	@Patch("heros/:key")
	@RequirePermissions(Permission.OWDLE_MANAGE)
	updateHero(
		@Param("key") key: string,
		@Body() dto: UpdateOwdleHeroDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<OwdleHeroDto> {
		return this.owdle.updateHero(key, dto, actor);
	}

	@Post("affiliations")
	@RequirePermissions(Permission.OWDLE_MANAGE)
	createAffiliation(
		@Body() dto: SaveOwdleAffiliationDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<OwdleAffiliationDto> {
		return this.owdle.createAffiliation(dto, actor);
	}

	@Patch("affiliations/:key")
	@RequirePermissions(Permission.OWDLE_MANAGE)
	renameAffiliation(
		@Param("key") key: string,
		@Body() dto: SaveOwdleAffiliationDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<OwdleAffiliationDto> {
		return this.owdle.renameAffiliation(key, dto, actor);
	}

	/** Refusee tant qu'un heros la porte : elle ne disparait jamais d'une fiche. */
	@Delete("affiliations/:key")
	@RequirePermissions(Permission.OWDLE_MANAGE)
	@HttpCode(HttpStatus.NO_CONTENT)
	removeAffiliation(
		@Param("key") key: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.owdle.removeAffiliation(key, actor);
	}
}
