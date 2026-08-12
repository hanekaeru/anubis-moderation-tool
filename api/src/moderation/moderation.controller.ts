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
	UpdateNoteDto,
	WarningQueryDto,
} from "./dto/moderation.dto";
import { NotesService } from "./notes.service";
import { SanctionsService } from "./sanctions.service";
import { WarningsService } from "./warnings.service";

@Controller("warnings")
export class WarningsController {
	constructor(private readonly warnings: WarningsService) {}

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
}

@Controller("sanctions")
export class SanctionsController {
	constructor(private readonly sanctions: SanctionsService) {}

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
