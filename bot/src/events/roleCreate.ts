import { Events } from "discord.js";
import type { BotEvent } from "../types";
import * as referentiel from "../collectors/referentiel";

const event: BotEvent<typeof Events.GuildRoleCreate> = {
	name: Events.GuildRoleCreate,
	once: false,
	async execute(role) {
		try {
			await referentiel.upsertRole(role);
		} catch (err) {
			console.error("[Référentiel] Rôle non enregistré :", err);
		}
	},
};

export = event;
