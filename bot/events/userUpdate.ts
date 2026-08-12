import { Events } from "discord.js";
import type { BotEvent } from "../src/types";
import { IdentityEventType } from "@anubis/shared";
import * as referentiel from "../src/collectors/referentiel";

const event: BotEvent<typeof Events.UserUpdate> = {
	name: Events.UserUpdate,
	once: false,
	async execute(ancien, nouveau) {
		try {
			await referentiel.upsertUser(nouveau);

			// L'identite est globale a Discord, pas propre a un serveur :
			// `guildId` reste nul, la fiche membre lit l'historique par
			// utilisateur.
			if (ancien.username !== nouveau.username) {
				await referentiel.enregistrerEvenementIdentite(
					null,
					nouveau.id,
					IdentityEventType.USERNAME_CHANGED,
					ancien.username,
					nouveau.username,
				);
			}

			if (ancien.globalName !== nouveau.globalName) {
				await referentiel.enregistrerEvenementIdentite(
					null,
					nouveau.id,
					IdentityEventType.GLOBAL_NAME_CHANGED,
					ancien.globalName ?? null,
					nouveau.globalName ?? null,
				);
			}

			if (ancien.avatar !== nouveau.avatar) {
				await referentiel.enregistrerEvenementIdentite(
					null,
					nouveau.id,
					IdentityEventType.AVATAR_CHANGED,
					ancien.avatar ?? null,
					nouveau.avatar ?? null,
				);
			}
		} catch (err) {
			console.error(
				"[Referentiel] Changement d'identite non enregistre :",
				err,
			);
		}
	},
};

export = event;
