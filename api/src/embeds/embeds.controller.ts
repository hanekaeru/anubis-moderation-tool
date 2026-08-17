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
	type EmbedMessageDto,
	type Paginated,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import {
	CreateEmbedMessageDto,
	EmbedMessageQueryDto,
	UpdateEmbedMessageDto,
} from "./dto/embed.dto";
import { EmbedsService } from "./embeds.service";

@Controller("messages")
export class EmbedsController {
	constructor(private readonly embeds: EmbedsService) {}

	@Get()
	@RequirePermissions(Permission.EMBEDS_READ)
	list(@Query() query: EmbedMessageQueryDto): Promise<Paginated<EmbedMessageDto>> {
		return this.embeds.list(query);
	}

	@Get(":id")
	@RequirePermissions(Permission.EMBEDS_READ)
	findOne(@Param("id", ParseUUIDPipe) id: string): Promise<EmbedMessageDto> {
		return this.embeds.findOne(id);
	}

	@Post()
	@RequirePermissions(Permission.EMBEDS_WRITE)
	create(
		@Body() dto: CreateEmbedMessageDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EmbedMessageDto> {
		return this.embeds.create(dto, actor);
	}

	@Patch(":id")
	@RequirePermissions(Permission.EMBEDS_WRITE)
	update(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: UpdateEmbedMessageDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EmbedMessageDto> {
		return this.embeds.update(id, dto, actor);
	}

	/** Met le message en file : c'est le bot qui le publiera, pas cette requete. */
	@Post(":id/envoi")
	@RequirePermissions(Permission.EMBEDS_WRITE)
	send(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EmbedMessageDto> {
		return this.embeds.send(id, actor);
	}

	@Delete(":id")
	@RequirePermissions(Permission.EMBEDS_WRITE)
	@HttpCode(HttpStatus.NO_CONTENT)
	remove(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.embeds.remove(id, actor);
	}
}
