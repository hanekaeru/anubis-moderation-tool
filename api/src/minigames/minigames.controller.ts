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
	Res,
	StreamableFile,
	UploadedFile,
	UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import {
	MAX_MINIGAME_IMAGE_BYTES,
	Permission,
	type MinigameCalendarDto,
	type MinigameConfigDto,
	type MinigameEventDto,
	type MinigameMapDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import {
	CalendarQueryDto,
	CreateMinigameEventDto,
	CreateMinigameMapDto,
	UpdateMinigameConfigDto,
	UpdateMinigameEventDto,
	UpdateMinigameMapDto,
} from "./dto/minigames.dto";
import { MinigamesService } from "./minigames.service";

/** Garde en memoire, jamais sur disque : l'image part droit en base. */
const UPLOAD_OPTIONS = {
	limits: { fileSize: MAX_MINIGAME_IMAGE_BYTES, files: 1 },
};

/**
 * Le verrou de la veille 23:59 n'est pas une permission de route : le meme
 * appel est permis le 15 et refuse le 16 pour le jeu du 16. Il se tranche donc
 * dans le service, qui lit `minigames:manage` sur le compte.
 */
@Controller("mini-jeux")
export class MinigamesController {
	constructor(private readonly minigames: MinigamesService) {}

	@Get()
	@RequirePermissions(Permission.MINIGAMES_READ)
	calendar(@Query() query: CalendarQueryDto): Promise<MinigameCalendarDto> {
		return this.minigames.calendar(query.from, query.to);
	}

	@Patch("configuration")
	@RequirePermissions(Permission.MINIGAMES_MANAGE)
	updateConfig(
		@Body() dto: UpdateMinigameConfigDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<MinigameConfigDto> {
		return this.minigames.updateConfig(dto, actor);
	}

	@Post("jeux")
	@RequirePermissions(Permission.MINIGAMES_WRITE)
	createEvent(
		@Body() dto: CreateMinigameEventDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<MinigameEventDto> {
		return this.minigames.createEvent(dto, actor);
	}

	@Patch("jeux/:id")
	@RequirePermissions(Permission.MINIGAMES_WRITE)
	updateEvent(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: UpdateMinigameEventDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<MinigameEventDto> {
		return this.minigames.updateEvent(id, dto, actor);
	}

	/** Ne retire rien de Discord : voir `MinigamesService.removeEvent`. */
	@Delete("jeux/:id")
	@RequirePermissions(Permission.MINIGAMES_WRITE)
	@HttpCode(HttpStatus.NO_CONTENT)
	removeEvent(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.minigames.removeEvent(id, actor);
	}

	@Post("jeux/:id/images")
	@RequirePermissions(Permission.MINIGAMES_WRITE)
	@UseInterceptors(FileInterceptor("file", UPLOAD_OPTIONS))
	addImage(
		@Param("id", ParseUUIDPipe) id: string,
		@UploadedFile() file: Express.Multer.File,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<MinigameEventDto> {
		return this.minigames.addImage(id, file, actor);
	}

	@Get("jeux/:id/images/:imageId")
	@RequirePermissions(Permission.MINIGAMES_READ)
	async downloadImage(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("imageId", ParseUUIDPipe) imageId: string,
		@Res({ passthrough: true }) res: Response,
	): Promise<StreamableFile> {
		const image = await this.minigames.downloadImage(id, imageId);
		res.set({
			"Content-Type": image.contentType,
			"Content-Disposition": `inline; filename="${encodeURIComponent(image.fileName)}"`,
			"X-Content-Type-Options": "nosniff",
		});
		return new StreamableFile(image.data);
	}

	@Delete("jeux/:id/images/:imageId")
	@RequirePermissions(Permission.MINIGAMES_WRITE)
	removeImage(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("imageId", ParseUUIDPipe) imageId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<MinigameEventDto> {
		return this.minigames.removeImage(id, imageId, actor);
	}

	@Post("maps")
	@RequirePermissions(Permission.MINIGAMES_MANAGE)
	createMap(
		@Body() dto: CreateMinigameMapDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<MinigameMapDto> {
		return this.minigames.createMap(dto, actor);
	}

	/** Pas de suppression : une map se desactive, sa cle vit dans les essais. */
	@Patch("maps/:key")
	@RequirePermissions(Permission.MINIGAMES_MANAGE)
	updateMap(
		@Param("key") key: string,
		@Body() dto: UpdateMinigameMapDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<MinigameMapDto> {
		return this.minigames.updateMap(key, dto, actor);
	}
}
