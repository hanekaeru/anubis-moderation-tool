import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
	Put,
} from "@nestjs/common";
import {
	Permission,
	type GuildConfigDto,
	type MentionSettingsDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import {
	CreateGuildConfigDto,
	UpdateGuildConfigDto,
	UpdateMentionSettingsDto,
} from "./dto/guild-config.dto";
import { GuildConfigService } from "./guild-config.service";

@Controller("guild-config")
export class GuildConfigController {
	constructor(private readonly guildConfig: GuildConfigService) {}

	@Get()
	@RequirePermissions(Permission.LOGS_READ)
	list(): Promise<GuildConfigDto[]> {
		return this.guildConfig.list();
	}

	/**
	 * Lecture gardee par la permission d'**ecriture**, a dessein.
	 *
	 * Ces reglages decident de qui le bot interpelle sur le serveur : le
	 * proprietaire les a voulus reserves aux administrateurs. Rien n'y est
	 * consultable pour soi — la page n'existe que pour les changer.
	 */
	@Get("mentions")
	@RequirePermissions(Permission.LOGS_WRITE)
	getMentions(): Promise<MentionSettingsDto> {
		return this.guildConfig.getMentionSettings();
	}

	@Put("mentions")
	@RequirePermissions(Permission.LOGS_WRITE)
	updateMentions(
		@Body() dto: UpdateMentionSettingsDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<MentionSettingsDto> {
		return this.guildConfig.updateMentionSettings(dto, actor);
	}

	@Post()
	@RequirePermissions(Permission.LOGS_WRITE)
	create(
		@Body() dto: CreateGuildConfigDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<GuildConfigDto> {
		return this.guildConfig.create(dto, actor);
	}

	@Patch(":id")
	@RequirePermissions(Permission.LOGS_WRITE)
	update(
		@Param("id") id: string,
		@Body() dto: UpdateGuildConfigDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<GuildConfigDto> {
		return this.guildConfig.update(id, dto, actor);
	}

	@Delete(":id")
	@HttpCode(HttpStatus.NO_CONTENT)
	@RequirePermissions(Permission.LOGS_WRITE)
	remove(
		@Param("id") id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.guildConfig.remove(id, actor);
	}
}
