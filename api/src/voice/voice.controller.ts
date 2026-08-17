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
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import { CreateVoiceHubDto, UpdateVoiceHubDto } from "./dto/voice-hub.dto";
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
}
