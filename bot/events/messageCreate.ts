import { Events } from "discord.js";
import type { BotEvent } from "../src/types";
import xpManager from "../src/collectors/xp";
import activite from "../src/collectors/activite";
import * as referentiel from "../src/collectors/referentiel";
import { readInt } from "../src/env";

const cooldowns = new Set<string>();

// Sans cette valeur de repli, un parseInt sur une variable absente renvoyait
// NaN et setTimeout se declenchait immediatement : le cooldown ne servait a rien.
const COOLDOWN_PAR_DEFAUT = 60_000;

const event: BotEvent<typeof Events.MessageCreate> = {
	name: Events.MessageCreate,
	once: false,
	async execute(message) {
		if (message.author.bot) return;
		// Messages prives : aucune statistique de serveur a tenir.
		if (!message.inGuild()) return;

		// Le referentiel doit exister avant toute statistique : message_stats
		// porte des cles etrangeres vers le serveur, le membre et le salon.
		const contexteOk = await referentiel.garantirContexte(
			message.guild,
			message.author,
			message.channel,
		);

		if (contexteOk) {
			activite.enregistrerMessage(message);
		}

		const cooldownKey = `${message.author.id}:${message.guild.id}`;
		if (cooldowns.has(cooldownKey)) return;

		cooldowns.add(cooldownKey);
		setTimeout(
			() => cooldowns.delete(cooldownKey),
			readInt("COOLDOWN_BETWEEN_LEVEL_UP_MESSAGE", COOLDOWN_PAR_DEFAUT),
		);

		// You can get from 1 to 10 XP per message, plus a base of 15 XP.
		const randomXp = Math.floor(Math.random() * 11) + 15;
		await xpManager.addXp(message.author.id, message.guild.id, randomXp);
	},
};

export = event;
