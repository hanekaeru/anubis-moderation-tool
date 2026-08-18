import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
} from "@nestjs/common";
import {
	Permission,
	type LiveVoiceDto,
	type Snowflake,
	type VoiceHubDto,
	type VoiceHubPlatformDto,
	type VoiceHubRankDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import {
	CreateVoiceHubDto,
	CreateVoiceHubPlatformDto,
	CreateVoiceHubRankDto,
	UpdateVoiceHubDto,
	UpdateVoiceHubPlatformDto,
	UpdateVoiceHubRankDto,
} from "./dto/voice-hub.dto";
import { VoiceService } from "./voice.service";

@Controller("voice")
export class VoiceController {
	constructor(private readonly voice: VoiceService) {}

	/** Declare avant :id, sinon "live" serait pris pour un identifiant. */
	@Get("live")
	@RequirePermissions(Permission.VOICE_READ)
	getLive(): Promise<LiveVoiceDto> {
		return this.voice.getLive();
	}

	@Get("hubs")
	@RequirePermissions(Permission.VOICE_READ)
	listHubs(): Promise<VoiceHubDto[]> {
		return this.voice.listHubs();
	}

	@Post("hubs")
	@RequirePermissions(Permission.VOICE_MANAGE)
	createHub(
		@Body() dto: CreateVoiceHubDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<VoiceHubDto> {
		return this.voice.createHub(dto, actor);
	}

	@Patch("hubs/:id")
	@RequirePermissions(Permission.VOICE_MANAGE)
	updateHub(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: UpdateVoiceHubDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<VoiceHubDto> {
		return this.voice.updateHub(id, dto, actor);
	}

	@Delete("hubs/:id")
	@RequirePermissions(Permission.VOICE_MANAGE)
	deleteHub(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<{ channelId: Snowflake | null }> {
		return this.voice.deleteHub(id, actor);
	}

	@Post("hubs/:id/ranks")
	@RequirePermissions(Permission.VOICE_MANAGE)
	createRank(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: CreateVoiceHubRankDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<VoiceHubRankDto> {
		return this.voice.createRank(id, dto, actor);
	}

	@Patch("hubs/:id/ranks/:rankId")
	@RequirePermissions(Permission.VOICE_MANAGE)
	updateRank(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("rankId", ParseUUIDPipe) rankId: string,
		@Body() dto: UpdateVoiceHubRankDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<VoiceHubRankDto> {
		return this.voice.updateRank(id, rankId, dto, actor);
	}

	@Delete("hubs/:id/ranks/:rankId")
	@RequirePermissions(Permission.VOICE_MANAGE)
	deleteRank(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("rankId", ParseUUIDPipe) rankId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.voice.deleteRank(id, rankId, actor);
	}

	@Post("hubs/:id/platforms")
	@RequirePermissions(Permission.VOICE_MANAGE)
	createPlatform(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: CreateVoiceHubPlatformDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<VoiceHubPlatformDto> {
		return this.voice.createPlatform(id, dto, actor);
	}

	@Patch("hubs/:id/platforms/:platformId")
	@RequirePermissions(Permission.VOICE_MANAGE)
	updatePlatform(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("platformId", ParseUUIDPipe) platformId: string,
		@Body() dto: UpdateVoiceHubPlatformDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<VoiceHubPlatformDto> {
		return this.voice.updatePlatform(id, platformId, dto, actor);
	}

	@Delete("hubs/:id/platforms/:platformId")
	@RequirePermissions(Permission.VOICE_MANAGE)
	deletePlatform(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("platformId", ParseUUIDPipe) platformId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.voice.deletePlatform(id, platformId, actor);
	}
}
