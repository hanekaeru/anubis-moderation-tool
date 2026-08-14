import { Events } from "discord.js";
import type { BotEvent } from "../src/types";
import { recordHeartbeat } from "../src/collectors/heartbeat";
import * as raid from "../src/collectors/raid";
import * as referentiel from "../src/collectors/referentiel";
import * as tickets from "../src/collectors/tickets";
import {
	checkAppliedSanctions,
	checkExpiredShadowbans,
	checkRevokedSanctions,
} from "../src/tasks/sanctionSync";
import { checkPendingTicketSync } from "../src/tasks/ticketSync";

/**
 * Delai entre deux passages de rattrapage Discord (sanctions, tickets,
 * confinements anti-raid demandes depuis la webapp). Reduit de 30s a 5s : au
 * dela des sanctions, ce cycle couvre desormais aussi les tickets et le
 * confinement anti-raid, ou une reaction plus rapide compte davantage.
 */
const DISCORD_SYNC_INTERVAL_MS = 5_000;

const event: BotEvent<typeof Events.ClientReady> = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
		console.log(`Deployed on ${process.env.NODE_ENV} env...`);

		// Necessaire avant toute sanction posee par l'automod (moderatorId
		// pointe vers ce compte) : sans upsert prealable, la creation echouerait
		// sur la contrainte de cle etrangere au tout premier declenchement.
		await referentiel.upsertUser(client.user).catch((err) => {
			console.error("[Referentiel] Compte du bot non enregistre :", err);
		});

		for (const guild of client.guilds.cache.values()) {
			try {
				await referentiel.synchroniserServeur(guild);
			} catch (err) {
				console.error(`[Referentiel] Échec sur ${guild.name} :`, err);
			}

			try {
				await tickets.loadTicketChannelsCache(guild.id);
			} catch (err) {
				console.error(`[Tickets] Cache des salons non charge sur ${guild.name} :`, err);
			}
		}

		// Premier battement immediat : sans lui, la page de statut affiche le bot
		// hors ligne pendant les premieres secondes suivant un redemarrage.
		await recordHeartbeat(client).catch((err) => {
			console.error("[Statut] Battement initial non enregistre :", err);
		});

		setInterval(() => {
			recordHeartbeat(client).catch((err) => {
				console.error("[Statut] Battement non enregistre :", err);
			});
			checkExpiredShadowbans(client).catch((err) => {
				console.error(
					"[Shadowban] Vérification des expirations échouée :",
					err,
				);
			});
			checkRevokedSanctions(client).catch((err) => {
				console.error(
					"[Moderation] Synchronisation des révocations échouée :",
					err,
				);
			});
			checkAppliedSanctions(client).catch((err) => {
				console.error(
					"[Moderation] Récupération des sanctions actives échouée :",
					err,
				);
			});
			checkPendingTicketSync(client).catch((err) => {
				console.error("[Tickets] Synchronisation Discord échouée :", err);
			});
			raid.applyPendingLockdowns(client).catch((err) => {
				console.error("[Raid] Application des confinements échouée :", err);
			});
			raid.applyPendingResolutions(client).catch((err) => {
				console.error("[Raid] Levée des confinements échouée :", err);
			});
		}, DISCORD_SYNC_INTERVAL_MS);
	},
};

export = event;
