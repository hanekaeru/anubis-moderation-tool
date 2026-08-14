import { BadRequestException, Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import {
	AutomodRuleType,
	Permission,
	type AutomodIncidentDto,
	type AutomodRuleDto,
	type Paginated,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import { AutomodService } from "./automod.service";
import { AutomodIncidentQueryDto, UpdateAutomodRuleDto } from "./dto/automod.dto";

@Controller("automod")
export class AutomodController {
	constructor(private readonly automod: AutomodService) {}

	@Get("rules")
	@RequirePermissions(Permission.AUTOMOD_READ)
	listRules(): Promise<AutomodRuleDto[]> {
		return this.automod.listRules();
	}

	@Patch("rules/:type")
	@RequirePermissions(Permission.AUTOMOD_WRITE)
	upsertRule(
		@Param("type") type: string,
		@Body() dto: UpdateAutomodRuleDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<AutomodRuleDto> {
		if (!Object.values(AutomodRuleType).includes(type as AutomodRuleType)) {
			throw new BadRequestException("Type de regle inconnu.");
		}
		return this.automod.upsertRule(type as AutomodRuleType, dto, actor);
	}

	@Get("incidents")
	@RequirePermissions(Permission.AUTOMOD_READ)
	listIncidents(@Query() query: AutomodIncidentQueryDto): Promise<Paginated<AutomodIncidentDto>> {
		return this.automod.listIncidents(query);
	}
}
