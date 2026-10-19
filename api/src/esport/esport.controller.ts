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
} from "@nestjs/common";
import {
	Permission,
	type EsportConfigDto,
	type EsportTeamDto,
	type EsportWeekDto,
	type EsportWeekSummaryDto,
	type LiquipediaScoresDto,
	type LiquipediaWeekDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import {
	CreateEsportWeekDto,
	EsportImportDtoIn,
	EsportMatchDtoIn,
	EsportResultDtoIn,
	EsportTeamDtoIn,
	UpdateEsportConfigDto,
	UpdateEsportWeekDto,
} from "./dto/esport.dto";
import { EsportImportService } from "./esport-import.service";
import { EsportService } from "./esport.service";

/**
 * Recapitulatifs esport.
 *
 * Trois niveaux : lire (`esport:read`), composer et envoyer (`esport:write`),
 * regler et **retirer un message publie** (`esport:manage`). Rien ici ne parle
 * a Discord : l'API met en file, le bot publie. L'import Liquipedia et la
 * recuperation des scores demandent `esport:write`, comme la saisie : ils ne
 * font que preremplir, et « Terminer » reste le seul chemin vers un score.
 */
@Controller("esport")
export class EsportController {
	constructor(
		private readonly esport: EsportService,
		private readonly imports: EsportImportService,
	) {}

	@Get("configuration")
	@RequirePermissions(Permission.ESPORT_READ)
	getConfig(): Promise<EsportConfigDto> {
		return this.esport.getConfig();
	}

	@Patch("configuration")
	@RequirePermissions(Permission.ESPORT_MANAGE)
	updateConfig(
		@Body() dto: UpdateEsportConfigDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportConfigDto> {
		return this.esport.updateConfig(dto, actor);
	}

	@Get("equipes")
	@RequirePermissions(Permission.ESPORT_READ)
	listTeams(): Promise<EsportTeamDto[]> {
		return this.esport.listTeams();
	}

	@Post("equipes")
	@RequirePermissions(Permission.ESPORT_WRITE)
	createTeam(
		@Body() dto: EsportTeamDtoIn,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportTeamDto> {
		return this.esport.createTeam(dto, actor);
	}

	@Patch("equipes/:id")
	@RequirePermissions(Permission.ESPORT_WRITE)
	updateTeam(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: EsportTeamDtoIn,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportTeamDto> {
		return this.esport.updateTeam(id, dto, actor);
	}

	/** Archive l'equipe si elle a deja joue, la supprime sinon. */
	@Delete("equipes/:id")
	@RequirePermissions(Permission.ESPORT_WRITE)
	async removeTeam(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<{ archived: EsportTeamDto | null }> {
		return { archived: await this.esport.removeTeam(id, actor) };
	}

	@Post("equipes/:id/restauration")
	@RequirePermissions(Permission.ESPORT_WRITE)
	restoreTeam(@Param("id", ParseUUIDPipe) id: string): Promise<EsportTeamDto> {
		return this.esport.restoreTeam(id);
	}

	@Get("semaines")
	@RequirePermissions(Permission.ESPORT_READ)
	listWeeks(): Promise<EsportWeekSummaryDto[]> {
		return this.esport.listWeeks();
	}

	/** Semaine contenant ce jour ; `{ week: null }` si elle n'existe pas encore. */
	@Get("semaines/:weekStart")
	@RequirePermissions(Permission.ESPORT_READ)
	async getWeek(@Param("weekStart") weekStart: string): Promise<{ week: EsportWeekDto | null }> {
		return { week: await this.esport.getWeek(weekStart) };
	}

	@Post("semaines")
	@RequirePermissions(Permission.ESPORT_WRITE)
	createWeek(
		@Body() dto: CreateEsportWeekDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		return this.esport.createWeek(dto.weekStart, actor);
	}

	@Patch("semaines/:id")
	@RequirePermissions(Permission.ESPORT_WRITE)
	updateWeek(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: UpdateEsportWeekDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		return this.esport.updateWeek(id, dto, actor);
	}

	/** Efface l'historique de la semaine ; le message Discord, lui, reste. */
	@Delete("semaines/:id")
	@RequirePermissions(Permission.ESPORT_MANAGE)
	@HttpCode(HttpStatus.NO_CONTENT)
	deleteWeek(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<void> {
		return this.esport.deleteWeek(id, actor);
	}

	@Post("semaines/:id/envoi")
	@RequirePermissions(Permission.ESPORT_WRITE)
	publishWeek(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		return this.esport.publishWeek(id, actor);
	}

	@Post("semaines/:id/retrait")
	@RequirePermissions(Permission.ESPORT_MANAGE)
	removeWeekMessage(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		return this.esport.removeWeekMessage(id, actor);
	}

	@Post("semaines/:id/matchs")
	@RequirePermissions(Permission.ESPORT_WRITE)
	addMatch(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: EsportMatchDtoIn,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		return this.esport.addMatch(id, dto, actor);
	}

	/** Matchs Liquipedia de la semaine, depuis le cache (un appel s'il est vide). */
	@Get("semaines/:id/liquipedia")
	@RequirePermissions(Permission.ESPORT_WRITE)
	liquipediaWeek(@Param("id", ParseUUIDPipe) id: string): Promise<LiquipediaWeekDto> {
		return this.imports.weekView(id);
	}

	@Post("semaines/:id/liquipedia/actualisation")
	@RequirePermissions(Permission.ESPORT_WRITE)
	refreshLiquipedia(@Param("id", ParseUUIDPipe) id: string): Promise<LiquipediaWeekDto> {
		return this.imports.refresh(id);
	}

	/** Pose les scores de Liquipedia en propositions ; rien n'est publie. */
	@Post("semaines/:id/liquipedia/scores")
	@RequirePermissions(Permission.ESPORT_WRITE)
	fetchScores(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<LiquipediaScoresDto> {
		return this.imports.fetchScores(id, actor);
	}

	@Post("semaines/:id/import")
	@RequirePermissions(Permission.ESPORT_WRITE)
	importMatches(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: EsportImportDtoIn,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		return this.imports.import(id, dto.ids, actor);
	}

	/** Ecarte le score propose par Liquipedia, sans toucher au match. */
	@Delete("matchs/:id/proposition")
	@RequirePermissions(Permission.ESPORT_WRITE)
	dismissSuggestion(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		return this.imports.dismissSuggestion(id, actor);
	}

	@Patch("matchs/:id")
	@RequirePermissions(Permission.ESPORT_WRITE)
	updateMatch(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: EsportMatchDtoIn,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		return this.esport.updateMatch(id, dto, actor);
	}

	@Delete("matchs/:id")
	@RequirePermissions(Permission.ESPORT_WRITE)
	deleteMatch(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		return this.esport.deleteMatch(id, actor);
	}

	@Put("matchs/:id/resultat")
	@RequirePermissions(Permission.ESPORT_WRITE)
	setResult(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: EsportResultDtoIn,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		return this.esport.setResult(id, dto, actor);
	}

	@Delete("matchs/:id/resultat")
	@RequirePermissions(Permission.ESPORT_WRITE)
	reopenMatch(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		return this.esport.reopenMatch(id, actor);
	}

	@Post("matchs/:id/resultat/retrait")
	@RequirePermissions(Permission.ESPORT_MANAGE)
	removeResultMessage(
		@Param("id", ParseUUIDPipe) id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		return this.esport.removeResultMessage(id, actor);
	}
}
