import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
} from "@nestjs/common";
import {
	Permission,
	type Paginated,
	type XpLeaderboardRowDto,
	type XpOverviewDto,
	type XpRewardRoleDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import {
	CreateXpRewardRoleDto,
	UpdateXpRewardRoleDto,
	XpLeaderboardQueryDto,
} from "./dto/xp.dto";
import { XpService } from "./xp.service";

@Controller("experience")
export class XpController {
	constructor(private readonly xp: XpService) {}

	@Get()
	@RequirePermissions(Permission.XP_READ)
	overview(): Promise<XpOverviewDto> {
		return this.xp.overview();
	}

	@Get("classement")
	@RequirePermissions(Permission.XP_READ)
	leaderboard(
		@Query() query: XpLeaderboardQueryDto,
	): Promise<Paginated<XpLeaderboardRowDto>> {
		return this.xp.leaderboard(query);
	}

	/**
	 * Avant `membres/:userId`, sinon « recompenses » serait lu comme un
	 * identifiant Discord et la route repondrait 404.
	 */
	@Get("recompenses")
	@RequirePermissions(Permission.XP_READ)
	listRewards(): Promise<XpRewardRoleDto[]> {
		return this.xp.listRewards();
	}

	@Get("membres/:userId")
	@RequirePermissions(Permission.XP_READ)
	memberProgress(@Param("userId") userId: string): Promise<XpLeaderboardRowDto> {
		return this.xp.memberProgress(userId);
	}

	@Post("recompenses")
	@RequirePermissions(Permission.XP_MANAGE)
	createReward(
		@Body() dto: CreateXpRewardRoleDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<XpRewardRoleDto> {
		return this.xp.createReward(dto, actor);
	}

	@Patch("recompenses/:id")
	@RequirePermissions(Permission.XP_MANAGE)
	updateReward(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: UpdateXpRewardRoleDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<XpRewardRoleDto> {
		return this.xp.updateReward(id, dto, actor);
	}

	@Delete("recompenses/:id")
	@RequirePermissions(Permission.XP_MANAGE)
	@HttpCode(HttpStatus.NO_CONTENT)
	removeReward(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.xp.removeReward(id, actor);
	}
}
