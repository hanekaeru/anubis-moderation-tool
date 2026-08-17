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
	type WikiArticleDto,
	type WikiArticleSummaryDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import {
	CreateWikiArticleDto,
	UpdateWikiArticleDto,
	WikiQueryDto,
} from "./dto/wiki.dto";
import { WikiService } from "./wiki.service";

@Controller("wiki")
export class WikiController {
	constructor(private readonly wiki: WikiService) {}

	@Get()
	@RequirePermissions(Permission.WIKI_READ)
	search(@Query() query: WikiQueryDto): Promise<WikiArticleSummaryDto[]> {
		return this.wiki.search(query);
	}

	/**
	 * Lecture par slug et non par identifiant : c'est l'adresse que l'equipe se
	 * partage, et elle doit rester lisible dans un message Discord.
	 *
	 * La route est declaree apres `@Get()` : un slug ne peut pas entrer en
	 * collision avec elle, mais l'ordre reste celui qu'on attend.
	 */
	@Get(":slug")
	@RequirePermissions(Permission.WIKI_READ)
	findOne(@Param("slug") slug: string): Promise<WikiArticleDto> {
		return this.wiki.findBySlug(slug);
	}

	@Post()
	@RequirePermissions(Permission.WIKI_WRITE)
	create(
		@Body() dto: CreateWikiArticleDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<WikiArticleDto> {
		return this.wiki.create(dto, actor);
	}

	@Patch(":id")
	@RequirePermissions(Permission.WIKI_WRITE)
	update(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: UpdateWikiArticleDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<WikiArticleDto> {
		return this.wiki.update(id, dto, actor);
	}

	@Post(":id/restore")
	@RequirePermissions(Permission.WIKI_DELETE)
	restore(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<WikiArticleDto> {
		return this.wiki.restore(id, actor);
	}

	@Delete(":id")
	@RequirePermissions(Permission.WIKI_DELETE)
	@HttpCode(HttpStatus.NO_CONTENT)
	remove(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.wiki.remove(id, actor);
	}
}
