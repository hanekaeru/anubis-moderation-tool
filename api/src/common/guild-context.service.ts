import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../config/configuration";

/**
 * Le dashboard administre un seul serveur, dont l'identifiant vient de la
 * configuration. Toutes les requetes passent par ici plutot que de lire la
 * config directement : le jour ou plusieurs serveurs seront geres, seul ce
 * service change (il lira le serveur courant depuis la requete ou la session).
 */
@Injectable()
export class GuildContextService {
	constructor(
		private readonly config: ConfigService<{ app: AppConfig }, true>,
	) {}

	get guildId(): string {
		return this.config.get("app", { infer: true }).guildId;
	}
}
