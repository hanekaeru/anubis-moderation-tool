import { Events } from "discord.js";
import type { BotEvent } from "../types";
import * as referentiel from "../collectors/referentiel";

const event: BotEvent<typeof Events.GuildRoleDelete> = {
	name: Events.GuildRoleDelete,
	once: false,
	async execute(role) {
		try {
			await referentiel.marquerRoleSupprime(role.id);
		} catch (err) {
			console.error(
				"[Référentiel] Suppression de rôle non enregistrée :",
				err,
			);
		}
	},
};

export = event;
