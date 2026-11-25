import { Controller, Get } from "@nestjs/common";
import type { InboxDto } from "@anubis/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../common/types";
import { InboxService } from "./inbox.service";

/**
 * Pas de `@RequirePermissions` : la route est ouverte a tout compte connecte,
 * et c'est le service qui ne calcule que les sections permises.
 */
@Controller("a-traiter")
export class InboxController {
	constructor(private readonly inbox: InboxService) {}

	@Get()
	list(@CurrentUser() actor: AuthenticatedUser): Promise<InboxDto> {
		return this.inbox.forUser(actor);
	}
}
