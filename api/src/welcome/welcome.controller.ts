import { Body, Controller, Get, Patch } from "@nestjs/common";
import { Permission, type WelcomeConfigDto } from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { AuthenticatedUser } from "../common/types";
import { UpdateWelcomeConfigDto } from "./dto/welcome.dto";
import { WelcomeService } from "./welcome.service";

/**
 * Messages d'arrivee, de depart et de boost.
 *
 * Memes permissions que la configuration du serveur (`logs:read` /
 * `logs:write`) : c'est un reglage de salon, au meme titre que les journaux.
 */
@Controller("welcome")
export class WelcomeController {
	constructor(private readonly welcome: WelcomeService) {}

	@Get("configuration")
	@RequirePermissions(Permission.LOGS_READ)
	getConfig(): Promise<WelcomeConfigDto> {
		return this.welcome.getConfig();
	}

	@Patch("configuration")
	@RequirePermissions(Permission.LOGS_WRITE)
	updateConfig(
		@Body() dto: UpdateWelcomeConfigDto,
		@CurrentUser() actor: AuthenticatedUser,
	): Promise<WelcomeConfigDto> {
		return this.welcome.updateConfig(dto, actor);
	}
}
