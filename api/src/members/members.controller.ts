import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import {
	Permission,
	type MemberDetail,
	type MemberListItem,
	type Paginated,
	type RoleSummary,
	type TimelineEntry,
	type VoiceSessionDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { SnowflakeParam } from "../common/pipes/snowflake.pipe";
import type { AuthenticatedUser } from "../common/types";
import {
	MemberQueryDto,
	TimelineQueryDto,
	UpdateRoleTrackingDto,
	VoiceSessionQueryDto,
} from "./dto/member-query.dto";
import { MembersService } from "./members.service";

@Controller("members")
@RequirePermissions(Permission.MEMBERS_READ)
export class MembersController {
	constructor(private readonly members: MembersService) { }

	@Get()
	search(@Query() query: MemberQueryDto): Promise<Paginated<MemberListItem>> {
		return this.members.search(query);
	}

	/** Declare avant :userId, sinon "roles" serait pris pour un identifiant. */
	@Get("roles")
	listRoles(): Promise<RoleSummary[]> {
		return this.members.listRoles();
	}

	/**
	 * Choisit si les mouvements d'un role sont historises.
	 *
	 * `ROLES_MANAGE` remplace ici la permission de classe : decider ce qui entre
	 * dans la chronologie releve de la configuration, pas de la lecture des
	 * membres.
	 */
	@Patch("roles/:roleId")
	@RequirePermissions(Permission.ROLES_MANAGE)
	setRoleTracking(
		@Param("roleId", SnowflakeParam) roleId: string,
		@Body() dto: UpdateRoleTrackingDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<RoleSummary> {
		return this.members.setRoleTracking(roleId, dto.trackHistory, actor);
	}

	@Get(":userId")
	findOne(
		@Param("userId", SnowflakeParam) userId: string,
	): Promise<MemberDetail> {
		return this.members.findOne(userId);
	}

	@Get(":userId/timeline")
	timeline(
		@Param("userId", SnowflakeParam) userId: string,
		@Query() query: TimelineQueryDto,
	): Promise<Paginated<TimelineEntry>> {
		return this.members.timeline(userId, query);
	}

	@Get(":userId/voice-sessions")
	voiceSessions(
		@Param("userId", SnowflakeParam) userId: string,
		@Query() query: VoiceSessionQueryDto,
	): Promise<Paginated<VoiceSessionDto>> {
		return this.members.voiceSessions(userId, query);
	}
}
