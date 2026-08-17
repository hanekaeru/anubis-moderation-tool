import { Events } from "discord.js";
import type { BotEvent } from "../types";
import * as referentiel from "../collectors/referentiel";

const event: BotEvent<typeof Events.ChannelUpdate> = {
	name: Events.ChannelUpdate,
	once: false,
	async execute(ancien, nouveau) {
		try {
			await referentiel.upsertChannel(nouveau);
		} catch (err) {
			console.error("[Référentiel] Salon non mis à jour :", err);
		}
	},
};

export = event;
