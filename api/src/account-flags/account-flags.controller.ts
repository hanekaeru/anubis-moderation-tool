import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Permission, type AccountFlagDto, type Paginated } from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import { AccountFlagsService } from "./account-flags.service";
import { AccountFlagQueryDto } from "./dto/account-flags.dto";

@Controller("account-flags")
export class AccountFlagsController {
	constructor(private readonly accountFlags: AccountFlagsService) {}

	@Get()
	@RequirePermissions(Permission.ACCOUNT_FLAGS_READ)
	search(@Query() query: AccountFlagQueryDto): Promise<Paginated<AccountFlagDto>> {
		return this.accountFlags.search(query);
	}

	@Post(":id/review")
	@RequirePermissions(Permission.ACCOUNT_FLAGS_WRITE)
	review(
		@Param("id") id: string,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<AccountFlagDto> {
		return this.accountFlags.review(id, actor);
	}
}
