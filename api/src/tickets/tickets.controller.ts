import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Put,
	Query,
	Res,
	StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import {
	Permission,
	type Paginated,
	type TicketConfigDto,
	type TicketDetail,
	type TicketListItem,
	type TicketModeratorPrefixDto,
	type TicketSubjectDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import {
	AddTicketNoteDto,
	CreateTicketSubjectDto,
	TicketQueryDto,
	UpdateTicketConfigDto,
	UpdateTicketDto,
	UpdateTicketSubjectDto,
	UpsertTicketPrefixDto,
} from "./dto/ticket.dto";
import { TicketsService } from "./tickets.service";

@Controller("tickets")
export class TicketsController {
	constructor(private readonly tickets: TicketsService) {}

	@Get()
	@RequirePermissions(Permission.TICKETS_READ)
	search(@Query() query: TicketQueryDto): Promise<Paginated<TicketListItem>> {
		return this.tickets.search(query);
	}

	/**
	 * Reglages, sujets et prefixes sont declares **avant** `:id` : le
	 * `ParseUUIDPipe` de la route par identifiant repondrait sinon 400 sur
	 * « config » avant que Nest n'atteigne ces routes.
	 */
	@Get("config")
	@RequirePermissions(Permission.TICKETS_READ)
	getConfig(): Promise<TicketConfigDto> {
		return this.tickets.getConfig();
	}

	@Patch("config")
	@RequirePermissions(Permission.TICKETS_WRITE)
	updateConfig(
		@Body() dto: UpdateTicketConfigDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<TicketConfigDto> {
		return this.tickets.updateConfig(dto, actor);
	}

	@Get("subjects")
	@RequirePermissions(Permission.TICKETS_READ)
	listSubjects(): Promise<TicketSubjectDto[]> {
		return this.tickets.listSubjects();
	}

	@Post("subjects")
	@RequirePermissions(Permission.TICKETS_WRITE)
	createSubject(
		@Body() dto: CreateTicketSubjectDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<TicketSubjectDto> {
		return this.tickets.createSubject(dto, actor);
	}

	@Patch("subjects/:subjectId")
	@RequirePermissions(Permission.TICKETS_WRITE)
	updateSubject(
		@Param("subjectId", ParseUUIDPipe) subjectId: string,
		@Body() dto: UpdateTicketSubjectDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<TicketSubjectDto> {
		return this.tickets.updateSubject(subjectId, dto, actor);
	}

	@Delete("subjects/:subjectId")
	@RequirePermissions(Permission.TICKETS_WRITE)
	deleteSubject(
		@Param("subjectId", ParseUUIDPipe) subjectId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.tickets.deleteSubject(subjectId, actor);
	}

	@Get("prefixes")
	@RequirePermissions(Permission.TICKETS_READ)
	listPrefixes(): Promise<TicketModeratorPrefixDto[]> {
		return this.tickets.listPrefixes();
	}

	@Put("prefixes/:userId")
	@RequirePermissions(Permission.TICKETS_WRITE)
	upsertPrefix(
		@Param("userId") userId: string,
		@Body() dto: UpsertTicketPrefixDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<TicketModeratorPrefixDto> {
		return this.tickets.upsertPrefix(userId, dto, actor);
	}

	@Delete("prefixes/:userId")
	@RequirePermissions(Permission.TICKETS_WRITE)
	deletePrefix(
		@Param("userId") userId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.tickets.deletePrefix(userId, actor);
	}

	@Get(":id")
	@RequirePermissions(Permission.TICKETS_READ)
	findOne(@Param("id", ParseUUIDPipe) id: string): Promise<TicketDetail> {
		return this.tickets.findOne(id);
	}

	@Patch(":id")
	@RequirePermissions(Permission.TICKETS_WRITE)
	update(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: UpdateTicketDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<TicketDetail> {
		return this.tickets.update(id, dto, actor);
	}

	@Post(":id/notes")
	@RequirePermissions(Permission.TICKETS_WRITE)
	addNote(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: AddTicketNoteDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<TicketDetail> {
		return this.tickets.addInternalNote(id, dto, actor);
	}

	@Get(":id/attachments/:attachmentId")
	@RequirePermissions(Permission.TICKETS_READ)
	async downloadAttachment(
		@Param("id", ParseUUIDPipe) id: string,
		@Param("attachmentId", ParseUUIDPipe) attachmentId: string,
		@Res({ passthrough: true }) res: Response,
	): Promise<StreamableFile> {
		const attachment = await this.tickets.getAttachment(id, attachmentId);

		res.set({
			"Content-Type": attachment.contentType,
			"Content-Disposition": `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
		});

		return new StreamableFile(attachment.data);
	}
}
