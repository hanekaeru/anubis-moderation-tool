import { Events } from "discord.js";
import type { BotEvent } from "../types";
import * as giveaway from "../collectors/giveaway";

/**
 * Participation a un concours.
 *
 * L'evenement n'est livre que si l'intent `GuildMessageReactions` est actif, et
 * seulement pour les messages en cache sans les partials `Message`,
 * `Reaction` et `User` : un concours publie avant le dernier redemarrage
 * n'aurait sinon plus jamais de participant — sans la moindre erreur. Voir
 * `bot/index.ts`.
 */
const event: BotEvent<typeof Events.MessageReactionAdd> = {
	name: Events.MessageReactionAdd,
	once: false,
	async execute(reaction, user) {
		if (!reaction.message.guildId) return;

		await giveaway.recordReaction(reaction, user).catch((err) => {
			console.error("[Giveaway] Enregistrement de la participation échoué :", err);
		});
	},
};

export = event;
