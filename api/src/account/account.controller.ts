import { Controller, Delete, Get, Post } from "@nestjs/common";
import type { DiscordLinkCodeDto, DiscordLinkStatusDto } from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../common/types";
import { AccountService } from "./account.service";

/**
 * Actions en libre-service sur le compte connecte lui-meme — a la difference
 * de `app-users/`, qui est l'administration d'autres comptes. Pas de
 * `@RequirePermissions` : le garde JWT global suffit, tout compte authentifie
 * peut gerer son propre rattachement Discord.
 */
@Controller("account")
export class AccountController {
	constructor(private readonly account: AccountService) {}

	@Post("discord-link/code")
	generateCode(
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<DiscordLinkCodeDto> {
		return this.account.generateDiscordLinkCode(actor);
	}

	@Get("discord-link")
	getLink(
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<DiscordLinkStatusDto> {
		return this.account.getDiscordLink(actor);
	}

	@Delete("discord-link")
	unlink(
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<DiscordLinkStatusDto> {
		return this.account.unlinkDiscord(actor);
	}
}
