import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import {
	Permission,
	type GiveawayDto,
	type GiveawayEntryDto,
	type Paginated,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import { CreateGiveawayDto, GiveawayQueryDto, UpdateGiveawayDto } from "./dto/giveaway.dto";
import { GiveawayService } from "./giveaway.service";

@Controller("giveaways")
export class GiveawayController {
	constructor(private readonly giveaways: GiveawayService) {}

	@Get()
	@RequirePermissions(Permission.GIVEAWAY_READ)
	list(@Query() query: GiveawayQueryDto): Promise<Paginated<GiveawayDto>> {
		return this.giveaways.list(query);
	}

	@Get(":id")
	@RequirePermissions(Permission.GIVEAWAY_READ)
	findOne(@Param("id", ParseUUIDPipe) id: string): Promise<GiveawayDto> {
		return this.giveaways.findOne(id);
	}

	@Get(":id/participations")
	@RequirePermissions(Permission.GIVEAWAY_READ)
	listEntries(@Param("id", ParseUUIDPipe) id: string): Promise<GiveawayEntryDto[]> {
		return this.giveaways.listEntries(id);
	}

	@Post()
	@RequirePermissions(Permission.GIVEAWAY_WRITE)
	create(
		@Body() dto: CreateGiveawayDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<GiveawayDto> {
		return this.giveaways.create(dto, actor);
	}

	@Patch(":id")
	@RequirePermissions(Permission.GIVEAWAY_WRITE)
	update(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: UpdateGiveawayDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<GiveawayDto> {
		return this.giveaways.update(id, dto, actor);
	}

	@Post(":id/annulation")
	@RequirePermissions(Permission.GIVEAWAY_WRITE)
	cancel(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<GiveawayDto> {
		return this.giveaways.cancel(id, actor);
	}

	@Post(":id/nouveau-tirage")
	@RequirePermissions(Permission.GIVEAWAY_WRITE)
	reroll(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<GiveawayDto> {
		return this.giveaways.reroll(id, actor);
	}
}
