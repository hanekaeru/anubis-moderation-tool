import { Body, Controller, Get, Param, ParseEnumPipe, Put } from "@nestjs/common";
import {
	AppUserRole,
	Permission,
	type RolePermissionsDto,
	type RolePermissionsMatrixDto,
} from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import { UpdateRolePermissionsDto } from "./dto/role-permissions.dto";
import { RolePermissionsService } from "./role-permissions.service";

@Controller("role-permissions")
@RequirePermissions(Permission.PERMISSIONS_MANAGE)
export class RolePermissionsController {
	constructor(private readonly rolePermissions: RolePermissionsService) {}

	@Get()
	getMatrix(): Promise<RolePermissionsMatrixDto> {
		return this.rolePermissions.getMatrix();
	}

	@Put(":role")
	updateRole(
		@Param("role", new ParseEnumPipe(AppUserRole)) role: AppUserRole,
		@Body() dto: UpdateRolePermissionsDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<RolePermissionsDto> {
		return this.rolePermissions.updateRole(role, dto.permissions, actor);
	}
}
