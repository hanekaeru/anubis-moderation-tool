import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { Permission, type RaidConfigDto, type RaidIncidentDto } from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import { UpdateRaidConfigDto } from "./dto/raid.dto";
import { RaidService } from "./raid.service";

@Controller("raid")
export class RaidController {
	constructor(private readonly raid: RaidService) {}

	@Get("config")
	@RequirePermissions(Permission.RAID_READ)
	getConfig(): Promise<RaidConfigDto> {
		return this.raid.getConfig();
	}

	@Patch("config")
	@RequirePermissions(Permission.RAID_CONFIGURE)
	updateConfig(
		@Body() dto: UpdateRaidConfigDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<RaidConfigDto> {
		return this.raid.updateConfig(dto, actor);
	}

	@Get("incidents")
	@RequirePermissions(Permission.RAID_READ)
	listIncidents(): Promise<RaidIncidentDto[]> {
		return this.raid.listIncidents();
	}

	@Post("lockdown")
	@RequirePermissions(Permission.RAID_RESPOND)
	triggerLockdown(@CurrentUser() actor: AuthenticatedUser): Promise<RaidIncidentDto> {
		return this.raid.triggerManualLockdown(actor);
	}

	@Post("incidents/:id/resolve")
	@RequirePermissions(Permission.RAID_RESPOND)
	resolve(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<RaidIncidentDto> {
		return this.raid.resolve(id, actor);
	}
}
