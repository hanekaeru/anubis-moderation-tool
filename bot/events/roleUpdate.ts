import { Events } from "discord.js";
import type { BotEvent } from "../src/types";
import * as referentiel from "../src/collectors/referentiel";

const event: BotEvent<typeof Events.GuildRoleUpdate> = {
	name: Events.GuildRoleUpdate,
	once: false,
	async execute(ancien, nouveau) {
		try {
			await referentiel.upsertRole(nouveau);
		} catch (err) {
			console.error("[Referentiel] Role non mis a jour :", err);
		}
	},
};

export = event;
