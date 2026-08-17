import { Controller, Delete, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import {
	Permission,
	type RevokeSessionsResponse,
	type SessionDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import { SessionQueryDto } from "./dto/session.dto";
import { SessionsService } from "./sessions.service";

/**
 * Sessions ouvertes sur le dashboard.
 *
 * `SESSIONS_READ` et `SESSIONS_REVOKE` sont absentes de la matrice par defaut :
 * seul le proprietaire les porte, parce que lire les traces de connexion de
 * toute l'equipe (adresses, navigateurs) et couper n'importe qui n'est pas de
 * l'administration courante.
 */
@Controller("sessions")
export class SessionsController {
	constructor(private readonly sessions: SessionsService) {}

	@Get()
	@RequirePermissions(Permission.SESSIONS_READ)
	list(
		@Query() query: SessionQueryDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<SessionDto[]> {
		return this.sessions.list(query, actor);
	}

	@Delete(":familyId")
	@RequirePermissions(Permission.SESSIONS_REVOKE)
	revoke(
		@Param("familyId", ParseUUIDPipe) familyId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<RevokeSessionsResponse> {
		return this.sessions.revoke(familyId, actor);
	}

	@Delete("compte/:appUserId")
	@RequirePermissions(Permission.SESSIONS_REVOKE)
	revokeAllForUser(
		@Param("appUserId", ParseUUIDPipe) appUserId: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<RevokeSessionsResponse> {
		return this.sessions.revokeAllForUser(appUserId, actor);
	}
}
