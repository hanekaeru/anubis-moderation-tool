import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { IsString, MaxLength } from "class-validator";
import { Permission, type MemberErasureResult } from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import { MemberDataService } from "./member-data.service";

class MemberErasureDto {
	@IsString()
	@MaxLength(30)
	confirmation!: string;
}

/**
 * Export et effacement RGPD. Un controleur a part, plutot que deux routes de
 * `MembersController` : celui-ci est ferme par `members:read` au niveau de la
 * classe, et ces deux routes ne doivent dependre que de `member-data:manage`.
 */
@Controller("members/:userId/donnees")
@RequirePermissions(Permission.MEMBER_DATA_MANAGE)
export class MemberDataController {
	constructor(private readonly data: MemberDataService) {}

	@Get()
	export(
		@Param("userId") userId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<Record<string, unknown>> {
		return this.data.export(userId, actor);
	}

	@Post("effacement")
	erase(
		@Param("userId") userId: string,
		@Body() dto: MemberErasureDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<MemberErasureResult> {
		return this.data.erase(userId, dto.confirmation, actor);
	}
}
