import { Events } from "discord.js";
import type { BotEvent } from "../types";
import * as referentiel from "../collectors/referentiel";

const event: BotEvent<typeof Events.GuildRoleUpdate> = {
	name: Events.GuildRoleUpdate,
	once: false,
	async execute(ancien, nouveau) {
		try {
			await referentiel.upsertRole(nouveau);
		} catch (err) {
			console.error("[Référentiel] Rôle non mis à jour :", err);
		}
	},
};

export = event;
