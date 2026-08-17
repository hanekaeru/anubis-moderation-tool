import { Events } from "discord.js";
import type { BotEvent } from "../types";
import * as giveaway from "../collectors/giveaway";

/** Retrait d'une participation : la reaction retiree annule l'inscription. */
const event: BotEvent<typeof Events.MessageReactionRemove> = {
	name: Events.MessageReactionRemove,
	once: false,
	async execute(reaction, user) {
		if (!reaction.message.guildId) return;

		await giveaway.removeReaction(reaction, user).catch((err) => {
			console.error("[Giveaway] Retrait de la participation échoué :", err);
		});
	},
};

export = event;
