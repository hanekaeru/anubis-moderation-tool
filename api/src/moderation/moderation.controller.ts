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
	Put,
	Query,
	Res,
	StreamableFile,
	UploadedFile,
	UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import {
	MAX_MODERATION_ATTACHMENT_BYTES,
	Permission,
	type ModerationAttachmentRef,
	type ModerationPointsConfigDto,
	type NoteDto,
	type Paginated,
	type SanctionDto,
	type WarningDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { SnowflakeParam } from "../common/pipes/snowflake.pipe";
import type { AuthenticatedUser } from "../common/types";
import {
	CreateNoteDto,
	CreateSanctionDto,
	CreateWarningDto,
	RevokeDto,
	SanctionQueryDto,
	UpdateModerationPointsDto,
	UpdateNoteDto,
	WarningQueryDto,
} from "./dto/moderation.dto";
import {
	ModerationAttachmentsService,
	type Cible,
} from "./moderation-attachments.service";
import { ModerationPointsService } from "./moderation-points.service";
import { NotesService } from "./notes.service";
import { SanctionsService } from "./sanctions.service";
import { WarningsService } from "./warnings.service";

/**
 * Le fichier est garde en memoire, jamais ecrit sur disque : il part droit en
 * base (`bytea`), et un conteneur sans volume persistant n'a de toute facon
 * nulle part ou le poser.
 */
const UPLOAD_OPTIONS = {
	limits: { fileSize: MAX_MODERATION_ATTACHMENT_BYTES, files: 1 },
};

/**
 * Lecture du marqueur « preuve explicite » d'un envoi multipart.
 *
 * Un champ multipart arrive toujours en chaine : `ValidationPipe` ne peut pas
 * le transformer en booleen, et un `Boolean("false")` vaudrait `true`. Seul le
 * mot exact `true` marque la piece — toute autre valeur, absence comprise, la
 * laisse visible.
 */
function lireSpoiler(value: unknown): boolean {
	return value === "true" || value === true;
}

/** En-tetes communs au telechargement d'une piece jointe. */
function serveAttachment(
	res: Response,
	attachment: { fileName: string; contentType: string; data: Uint8Array },
): StreamableFile {
	res.set({
		"Content-Type": attachment.contentType,
		"Content-Disposition": `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
		// Le fichier est servi tel qu'il a ete depose : interdire au navigateur
		// de deviner un autre type ferme la porte a un rendu inattendu.
		"X-Content-Type-Options": "nosniff",
	});

	return new StreamableFile(attachment.data);
}

@Controller("warnings")
export class WarningsController {
	private readonly cible: Cible = "warning";

	constructor(
		private readonly warnings: WarningsService,
		private readonly attachments: ModerationAttachmentsService,
	) {}

	@Get()
	@RequirePermissions(Permission.WARNINGS_READ)
	search(@Query() query: WarningQueryDto): Promise<Paginated<WarningDto>> {
		return this.warnings.search(query);
	}

	@Get(":id")
	@RequirePermissions(Permission.WARNINGS_READ)
	findOne(@Param("id", ParseUUIDPipe) id: string): Promise<WarningDto> {
		return this.warnings.findOne(id);
	}

	@Post()
	@RequirePermissions(Permission.WARNINGS_WRITE)
	create(
		@Body() dto: CreateWarningDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<WarningDto> {
		return this.warnings.create(dto, actor);
	}

	@Post(":id/revoke")
	@RequirePermissions(Permission.WARNINGS_REVOKE)
	revoke(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: RevokeDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<WarningDto> {
		return this.warnings.revoke(id, dto, actor);
	}

	@Post(":id/attachments")
	@RequirePermissions(Permission.WARNINGS_WRITE)
	@UseInterceptors(FileInterceptor("file", UPLOAD_OPTIONS))
	addAttachment(
		@Param("id", ParseUUIDPipe) id: string,
		@UploadedFile() file: Express.Multer.File,
		@CurrentUser() actor: AuthenticatedUser,
		@Body("spoiler") spoiler?: string,
	): Promise<ModerationAttachmentRef> {
		return this.attachments.upload(
			this.cible,
			id,
			file,
			actor,
			lireSpoiler(spoiler),
		);
	}

	@Get(":id/attachments/:attachmentId")
	@RequirePermissions(Permission.WARNINGS_READ)
	async downloadAttachment(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("attachmentId", ParseUUIDPipe) attachmentId: string,
		@Res({ passthrough: true }) res: Response,
	): Promise<StreamableFile> {
		return serveAttachment(
			res,
			await this.attachments.download(this.cible, id, attachmentId),
		);
	}

	@Delete(":id/attachments/:attachmentId")
	@RequirePermissions(Permission.WARNINGS_WRITE)
	@HttpCode(HttpStatus.NO_CONTENT)
	removeAttachment(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("attachmentId", ParseUUIDPipe) attachmentId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.attachments.remove(this.cible, id, attachmentId, actor);
	}
}

@Controller("sanctions")
export class SanctionsController {
	private readonly cible: Cible = "sanction";

	constructor(
		private readonly sanctions: SanctionsService,
		private readonly attachments: ModerationAttachmentsService,
	) {}

	@Get()
	@RequirePermissions(Permission.SANCTIONS_READ)
	search(@Query() query: SanctionQueryDto): Promise<Paginated<SanctionDto>> {
		return this.sanctions.search(query);
	}

	@Get(":id")
	@RequirePermissions(Permission.SANCTIONS_READ)
	findOne(@Param("id", ParseUUIDPipe) id: string): Promise<SanctionDto> {
		return this.sanctions.findOne(id);
	}

	@Post()
	@RequirePermissions(Permission.SANCTIONS_WRITE)
	create(
		@Body() dto: CreateSanctionDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<SanctionDto> {
		return this.sanctions.create(dto, actor);
	}

	@Post(":id/revoke")
	@RequirePermissions(Permission.SANCTIONS_REVOKE)
	revoke(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: RevokeDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<SanctionDto> {
		return this.sanctions.revoke(id, dto, actor);
	}

	@Post(":id/attachments")
	@RequirePermissions(Permission.SANCTIONS_WRITE)
	@UseInterceptors(FileInterceptor("file", UPLOAD_OPTIONS))
	addAttachment(
		@Param("id", ParseUUIDPipe) id: string,
		@UploadedFile() file: Express.Multer.File,
		@CurrentUser() actor: AuthenticatedUser,
		@Body("spoiler") spoiler?: string,
	): Promise<ModerationAttachmentRef> {
		return this.attachments.upload(
			this.cible,
			id,
			file,
			actor,
			lireSpoiler(spoiler),
		);
	}

	@Get(":id/attachments/:attachmentId")
	@RequirePermissions(Permission.SANCTIONS_READ)
	async downloadAttachment(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("attachmentId", ParseUUIDPipe) attachmentId: string,
		@Res({ passthrough: true }) res: Response,
	): Promise<StreamableFile> {
		return serveAttachment(
			res,
			await this.attachments.download(this.cible, id, attachmentId),
		);
	}

	@Delete(":id/attachments/:attachmentId")
	@RequirePermissions(Permission.SANCTIONS_WRITE)
	@HttpCode(HttpStatus.NO_CONTENT)
	removeAttachment(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("attachmentId", ParseUUIDPipe) attachmentId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.attachments.remove(this.cible, id, attachmentId, actor);
	}
}

@Controller("notes")
export class NotesController {
	constructor(private readonly notes: NotesService) {}

	@Get("member/:userId")
	@RequirePermissions(Permission.NOTES_READ)
	listForMember(
		@Param("userId", SnowflakeParam) userId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<NoteDto[]> {
		return this.notes.listForMember(userId, actor);
	}

	@Post()
	@RequirePermissions(Permission.NOTES_WRITE)
	create(
		@Body() dto: CreateNoteDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<NoteDto> {
		return this.notes.create(dto, actor);
	}

	@Patch(":id")
	@RequirePermissions(Permission.NOTES_WRITE)
	update(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: UpdateNoteDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<NoteDto> {
		return this.notes.update(id, dto, actor);
	}

	@Delete(":id")
	@RequirePermissions(Permission.NOTES_WRITE)
	@HttpCode(HttpStatus.NO_CONTENT)
	remove(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.notes.remove(id, actor);
	}
}

@Controller("moderation-points")
export class ModerationPointsController {
	constructor(private readonly points: ModerationPointsService) {}

	/**
	 * Lecture ouverte a qui peut lire les sanctions : le formulaire de sanction
	 * a besoin du bareme pour pre-remplir les points, y compris entre les mains
	 * d'un moderateur qui n'a pas le droit de le modifier.
	 */
	@Get()
	@RequirePermissions(Permission.SANCTIONS_READ)
	get(): Promise<ModerationPointsConfigDto> {
		return this.points.getConfig();
	}

	@Put()
	@RequirePermissions(Permission.MODERATION_POINTS_CONFIGURE)
	update(
		@Body() dto: UpdateModerationPointsDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<ModerationPointsConfigDto> {
		return this.points.updateConfig(dto, actor);
	}
}
