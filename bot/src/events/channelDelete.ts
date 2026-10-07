import { Events } from "discord.js";
import type { BotEvent } from "../types";
import * as referentiel from "../collectors/referentiel";
import * as tickets from "../collectors/tickets";
import * as voiceHubs from "../collectors/voiceHubs";

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
				"[Référentiel] Suppression de salon non enregistrée :",
				err,
			);
		}

		// Un salon temporaire supprime a la main : la ligne se referme, rien
		// n'est recree. Un hub, lui, garde son reglage et ne perd que son
		// identifiant de salon — via `supprimerSalonsDeCreation`.
		try {
			const etaitTemporaire = await voiceHubs.oublierSalon(channel.id);

			// Un salon temporaire supprime a la main laisse peut-etre sa categorie
			// de rangement vide. Les autres suppressions de salon n'en liberent
			// aucune : inutile de les parcourir a chaque fois.
			if (etaitTemporaire && !channel.isDMBased()) {
				await voiceHubs.nettoyerCategoriesVides(channel.guild);
			}
		} catch (err) {
			console.error("[Vocaux] Fermeture du salon temporaire échouée :", err);
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
				console.error("[Tickets] Archivage de secours échoué :", err);
			}
		}
	},
};

export = event;
