import { ArrayUnique, IsArray, IsIn, IsString } from "class-validator";
import { Permission } from "@anubis/shared";

export class UpdateRolePermissionsDto {
	@IsArray()
	@ArrayUnique()
	@IsString({ each: true })
	@IsIn(Object.values(Permission), { each: true })
	permissions!: Permission[];
}
