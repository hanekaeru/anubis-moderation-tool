import {
	Body,
	Controller,
	Get,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
} from "@nestjs/common";
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

	@Get("categories")
	@RequirePermissions(Permission.TICKETS_READ)
	listCategories(): Promise<string[]> {
		return this.tickets.listCategories();
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
}
