import {
	Body,
	Controller,
	Get,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
	Res,
	StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import {
	Permission,
	type Paginated,
	type TicketDetail,
	type TicketListItem,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import {
	AddTicketNoteDto,
	TicketQueryDto,
	UpdateTicketDto,
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
