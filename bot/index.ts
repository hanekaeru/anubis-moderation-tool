import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import prisma from "./src/prisma";
import activite from "./src/collectors/activite";
import * as voice from "./src/collectors/voice";
import xpManager from "./src/collectors/xp";
import { loadCommands } from "./src/loadCommands";
import { registerEvents } from "./src/loadEvents";
import { requireEnv } from "./src/env";

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildModeration,
		// Non privilegie, mais sans lui `voiceStateUpdate` n'est jamais livre et
		// `guild.voiceStates.cache` reste vide — sans la moindre erreur, comme
		// pour GuildModeration.
		GatewayIntentBits.GuildVoiceStates,
		// Intent privilegie : necessaire pour lire le contenu des messages des
		// salons de ticket (fil de discussion suivi sur la webapp). Le contenu
		// des autres salons continue de n'etre jamais persiste (voir
		// collectors/activite.ts). A activer dans le portail developpeur
		// Discord (Bot > Privileged Gateway Intents > Message Content Intent).
		GatewayIntentBits.MessageContent,
		// Non privilegie, mais sans lui `messageReactionAdd` /
		// `messageReactionRemove` ne sont **jamais livres** — meme piege silencieux
		// que GuildModeration. C'est par eux que passent les participations aux
		// concours.
		GatewayIntentBits.GuildMessageReactions,
	],
	// Une reaction posee sur un message anterieur au dernier demarrage arrive
	// sur un message absent du cache : sans ces partials, discord.js ecarte
	// l'evenement en silence et un concours publie avant un redemarrage
	// n'enregistrerait plus aucune participation.
	//
	// `messageDelete` et `messageUpdate` recoivent desormais eux aussi les
	// messages hors cache ; tous deux s'arretent deja sur `!message.author`,
	// qui est precisement ce que vaut un message partiel.
	partials: [Partials.Message, Partials.Reaction, Partials.User],
});

client.commands = loadCommands();
registerEvents(client);

client.on(Events.Error, (error) => {
	console.error("[Discord] Erreur du client :", error);
});

/**
 * Arret propre.
 *
 * L'XP et les statistiques d'activite vivent en memoire entre deux vidages :
 * quitter sans les ecrire perdrait tout ce qui a ete accumule depuis le dernier
 * flush, soit jusqu'a une quinzaine de secondes d'activite. Les sessions
 * vocales, elles, sont fermees ici a la seconde pres plutot que rattrapees au
 * prochain demarrage.
 */
let arretEnCours = false;

async function arreter(signal: NodeJS.Signals): Promise<void> {
	if (arretEnCours) return;
	arretEnCours = true;

	console.log(`[Bot] ${signal} reçu, vidage des buffers avant l'arrêt...`);

	try {
		await Promise.allSettled([
			xpManager.flush(),
			activite.vider(),
			voice.fermerSessionsEnCours(),
		]);
	} catch (err) {
		console.error("[Bot] Vidage incomplet :", err);
	}

	await client.destroy();
	await prisma.$disconnect();

	console.log("[Bot] Arret termine.");
	process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		void arreter(signal);
	});
}

client.login(requireEnv("BOT_TOKEN"));
