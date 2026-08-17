import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
	Permission,
	type QuarantineConfigDto,
	type QuarantineStatusDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { SnowflakeParam } from "../common/pipes/snowflake.pipe";
import type { AuthenticatedUser } from "../common/types";
import { UpdateQuarantineConfigDto } from "./dto/quarantine.dto";
import { QuarantineService } from "./quarantine.service";

@Controller("quarantine")
export class QuarantineController {
	constructor(private readonly quarantine: QuarantineService) {}

	@Get("config")
	@RequirePermissions(Permission.QUARANTINE_READ)
	getConfig(): Promise<QuarantineConfigDto> {
		return this.quarantine.getConfig();
	}

	@Patch("config")
	@RequirePermissions(Permission.QUARANTINE_CONFIGURE)
	updateConfig(
		@Body() dto: UpdateQuarantineConfigDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<QuarantineConfigDto> {
		return this.quarantine.updateConfig(dto, actor);
	}

	@Get("status")
	@RequirePermissions(Permission.QUARANTINE_READ)
	listActive(): Promise<QuarantineStatusDto[]> {
		return this.quarantine.listActive();
	}

	@Post("status/:userId/release")
	@RequirePermissions(Permission.QUARANTINE_RESPOND)
	release(
		@Param("userId", SnowflakeParam) userId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<QuarantineStatusDto> {
		return this.quarantine.release(userId, actor);
	}
}
