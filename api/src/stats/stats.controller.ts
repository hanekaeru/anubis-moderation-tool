import { Controller, Get, Param, Query } from "@nestjs/common";
import { IsIn, IsOptional } from "class-validator";
import {
	Permission,
	STATS_PERIOD_DAYS,
	type DashboardOverview,
	type MemberActivityStats,
	type StatsPeriod,
	type TicketStatsSummary,
} from "@anubis/shared";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { SnowflakeParam } from "../common/pipes/snowflake.pipe";
import { StatsService } from "./stats.service";

class StatsQueryDto {
	@IsOptional()
	@IsIn(Object.keys(STATS_PERIOD_DAYS))
	period: StatsPeriod = "30d";
}

@Controller("stats")
@RequirePermissions(Permission.STATS_READ)
export class StatsController {
	constructor(private readonly stats: StatsService) {}

	@Get("overview")
	overview(@Query() query: StatsQueryDto): Promise<DashboardOverview> {
		return this.stats.overview(query.period);
	}

	@Get("tickets")
	tickets(@Query() query: StatsQueryDto): Promise<TicketStatsSummary> {
		return this.stats.ticketStats(query.period);
	}

	@Get("members/:userId")
	memberActivity(
		@Param("userId", SnowflakeParam) userId: string,
		@Query() query: StatsQueryDto,
	): Promise<MemberActivityStats> {
		return this.stats.memberActivity(userId, query.period);
	}
}
