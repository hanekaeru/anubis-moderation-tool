import { Events } from "discord.js";
import type { BotEvent } from "../src/types";
import * as referentiel from "../src/collectors/referentiel";

const event: BotEvent<typeof Events.ChannelUpdate> = {
	name: Events.ChannelUpdate,
	once: false,
	async execute(ancien, nouveau) {
		try {
			await referentiel.upsertChannel(nouveau);
		} catch (err) {
			console.error("[Referentiel] Salon non mis a jour :", err);
		}
	},
};

export = event;
