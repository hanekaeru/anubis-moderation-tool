import { Controller, Get } from "@nestjs/common";
import { Permission, type StatusDto } from "@anubis/shared";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { StatusService } from "./status.service";

/**
 * Etat de fonctionnement d'Anubis, a destination du staff — a la difference de
 * `/health`, qui est publique et ne parle que de l'API elle-meme. Celle-ci
 * couvre aussi le process bot et les alertes de securite en cours.
 */
@Controller("status")
export class StatusController {
	constructor(private readonly status: StatusService) {}

	@Get()
	@RequirePermissions(Permission.STATUS_READ)
	getStatus(): Promise<StatusDto> {
		return this.status.getStatus();
	}
}
