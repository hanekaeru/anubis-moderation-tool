import { Events } from "discord.js";
import type { BotEvent } from "../types";
import * as referentiel from "../collectors/referentiel";
import * as shadowbanRole from "../collectors/shadowbanRole";

const event: BotEvent<typeof Events.ChannelCreate> = {
	name: Events.ChannelCreate,
	once: false,
	async execute(channel) {
		try {
			await referentiel.upsertChannel(channel);
		} catch (err) {
			console.error("[Référentiel] Salon non enregistré :", err);
		}

		try {
			await shadowbanRole.syncShadowbanOverwrite(channel);
		} catch (err) {
			console.error(
				"[Shadowban] Synchronisation du nouveau salon échouée :",
				err,
			);
		}
	},
};

export = event;
