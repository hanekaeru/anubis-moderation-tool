import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { IsBoolean } from "class-validator";
import { Permission, type BattlenetLinkDto } from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { SnowflakeParam } from "../common/pipes/snowflake.pipe";
import type { AuthenticatedUser } from "../common/types";
import { BattlenetLinksService } from "./battlenet-links.service";

class UnlinkBattlenetDto {
	@IsBoolean()
	release!: boolean;
}

/**
 * Lien Battle.net d'un membre, sur sa fiche.
 *
 * Savoir qu'un membre est verifie releve de la moderation courante
 * (`members:read`) ; son BattleTag non (`battlenet:read`, filtre dans le
 * service). Delier — et surtout liberer un compte Blizzard — est reserve aux
 * administrateurs (`battlenet:write`).
 */
@Controller("battlenet/links")
export class BattlenetLinksController {
	constructor(private readonly links: BattlenetLinksService) {}

	@Get(":userId")
	@RequirePermissions(Permission.MEMBERS_READ)
	get(
		@Param("userId", SnowflakeParam) userId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<BattlenetLinkDto> {
		return this.links.get(userId, actor);
	}

	@Post(":userId/unlink")
	@RequirePermissions(Permission.BATTLENET_WRITE)
	unlink(
		@Param("userId", SnowflakeParam) userId: string,
		@Body() dto: UnlinkBattlenetDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<BattlenetLinkDto> {
		return this.links.unlink(userId, dto.release, actor);
	}
}
