import { Events } from "discord.js";
import type { BotEvent } from "../src/types";
import * as referentiel from "../src/collectors/referentiel";

const event: BotEvent<typeof Events.ChannelDelete> = {
	name: Events.ChannelDelete,
	once: false,
	async execute(channel) {
		try {
			// Suppression logique : les statistiques de messages referencent ce
			// salon, l'effacer viderait l'historique d'activite des membres.
			await referentiel.marquerSalonSupprime(channel.id);
		} catch (err) {
			console.error(
				"[Referentiel] Suppression de salon non enregistree :",
				err,
			);
		}
	},
};

export = event;
