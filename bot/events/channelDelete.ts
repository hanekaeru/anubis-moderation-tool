import { Events } from "discord.js";
import type { BotEvent } from "../src/types";
import * as referentiel from "../src/collectors/referentiel";
import * as tickets from "../src/collectors/tickets";

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

		// Filet de securite : le chemin normal passe par le bouton "Supprimer"
		// (src/handlers/ticketInteractions.ts), qui poste le transcript avant de
		// supprimer lui-meme le salon et retire deja l'entree du cache. Si le
		// salon a ete supprime autrement (a la main dans Discord), on garde
		// quand meme la base coherente — mais sans transcript possible, le
		// contenu du salon n'etant plus accessible une fois supprime.
		const ticketId = tickets.ticketIdForChannel(channel.id);
		if (ticketId && !channel.isDMBased()) {
			try {
				await tickets.archiveAndForgetChannel(ticketId, channel.id, channel.name, false);
			} catch (err) {
				console.error("[Tickets] Archivage de secours echoue :", err);
			}
		}
	},
};

export = event;
