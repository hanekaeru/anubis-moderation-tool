import { Events } from "discord.js";
import type { BotEvent } from "../src/types";
import activite from "../src/collectors/activite";

const event: BotEvent<typeof Events.MessageDelete> = {
	name: Events.MessageDelete,
	once: false,
	async execute(message) {
		if (!message?.guild || message.author?.bot) return;

		// Discord ne renvoie que l'identifiant pour un message absent du cache :
		// une suppression ancienne n'est donc pas comptabilisee, faute d'auteur.
		if (!message.author) return;

		activite.enregistrerSuppression(message);
	},
};

export = event;
