import { Events } from "discord.js";
import type { BotEvent } from "../types";
import {
	lastKnownHeartbeat,
	recordHeartbeat,
} from "../collectors/heartbeat";
import * as giveaway from "../collectors/giveaway";
import * as quarantine from "../collectors/quarantine";
import { checkPendingAccountFlagAlerts } from "../tasks/accountFlagAlerts";
import { lienVerificationBattlenet } from "../utils/verificationLink";
import * as raid from "../collectors/raid";
import * as referentiel from "../collectors/referentiel";
import * as tickets from "../collectors/tickets";
import * as voice from "../collectors/voice";
import * as voiceHubs from "../collectors/voiceHubs";
import * as xpRewards from "../collectors/xpRewards";
import { checkPendingEmbeds } from "../tasks/embedSync";
import {
	checkAppliedSanctions,
	checkExpiredShadowbans,
	checkRevokedSanctions,
} from "../tasks/sanctionSync";
import { checkPendingTicketSync } from "../tasks/ticketSync";
import { deliverDueReminders } from "../tasks/reminders";
import { checkPendingWarningNotices } from "../tasks/warningNotice";

/**
 * Delai entre deux passages de rattrapage Discord (sanctions, tickets,
 * confinements anti-raid demandes depuis la webapp). Reduit de 30s a 5s : au
 * dela des sanctions, ce cycle couvre desormais aussi les tickets et le
 * confinement anti-raid, ou une reaction plus rapide compte davantage.
 */
const DISCORD_SYNC_INTERVAL_MS = 5_000;

/**
 * Delai entre deux rattrapages des paliers d'experience.
 *
 * Volontairement hors du cycle de 5s : ce passage lit toute la table d'XP
 * au-dessus du plus bas palier, et rien ne l'exige plus souvent. Les montees de
 * niveau, elles, sont traitees a l'instant meme par `messageCreate` — ce
 * rattrapage ne sert qu'aux paliers **ajoutes depuis le dashboard**, dont les
 * beneficiaires n'ont aucune raison de changer de niveau bientot.
 */
const XP_REWARD_SYNC_INTERVAL_MS = 300_000;

const event: BotEvent<typeof Events.ClientReady> = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
		console.log(`Deployed on ${process.env.NODE_ENV} env...`);

		// Une base publique absente ou absurde ne se voit autrement qu'au premier
		// clic d'un arrivant, sous la forme d'un refus de Discord. Elle se signale
		// donc au demarrage, comme l'avertissement `TWO_FACTOR_ENABLED` de l'API.
		if (!lienVerificationBattlenet(process.env.PUBLIC_API_URL, "verification")) {
			console.warn(
				"[Quarantaine] PUBLIC_API_URL absente ou invalide " +
					`(${JSON.stringify(process.env.PUBLIC_API_URL)}) : le bouton de ` +
					"vérification Battle.net répondra que la fonctionnalité n'est pas configurée.",
			);
		}

		// Necessaire avant toute sanction posee par l'automod (moderatorId
		// pointe vers ce compte) : sans upsert prealable, la creation echouerait
		// sur la contrainte de cle etrangere au tout premier declenchement.
		await referentiel.upsertUser(client.user).catch((err) => {
			console.error("[Référentiel] Compte du bot non enregistré :", err);
		});

		// Lu avant le premier battement, qui l'ecraserait avec l'heure courante :
		// c'est la seule trace de l'instant ou le bot s'est tu.
		const finProbable = (await lastKnownHeartbeat()) ?? new Date();

		for (const guild of client.guilds.cache.values()) {
			try {
				await referentiel.synchroniserServeur(guild);
			} catch (err) {
				console.error(`[Référentiel] Échec sur ${guild.name} :`, err);
			}

			try {
				await tickets.loadTicketChannelsCache(guild.id);
			} catch (err) {
				console.error(`[Tickets] Cache des salons non charge sur ${guild.name} :`, err);
			}

			try {
				await voice.reconcilierSessions(guild, finProbable);
			} catch (err) {
				console.error(`[Vocal] Réconciliation échouée sur ${guild.name} :`, err);
			}

			// Apres la reconciliation des sessions, dont elle lit le resultat
			// pour savoir quels salons temporaires sont encore occupes.
			try {
				await voiceHubs.reconcilierSalons(guild);
			} catch (err) {
				console.error(`[Vocaux] Réconciliation échouée sur ${guild.name} :`, err);
			}
		}

		// Premier battement immediat : sans lui, la page de statut affiche le bot
		// hors ligne pendant les premieres secondes suivant un redemarrage.
		await recordHeartbeat(client).catch((err) => {
			console.error("[Statut] Battement initial non enregistré :", err);
		});

		setInterval(() => {
			recordHeartbeat(client).catch((err) => {
				console.error("[Statut] Battement non enregistré :", err);
			});
			checkExpiredShadowbans(client).catch((err) => {
				console.error(
					"[Shadowban] Vérification des expirations échouée :",
					err,
				);
			});
			checkRevokedSanctions(client).catch((err) => {
				console.error(
					"[Modération] Synchronisation des révocations échouée :",
					err,
				);
			});
			checkAppliedSanctions(client).catch((err) => {
				console.error(
					"[Modération] Récupération des sanctions actives échouée :",
					err,
				);
			});
			checkPendingTicketSync(client).catch((err) => {
				console.error("[Tickets] Synchronisation Discord échouée :", err);
			});
			checkPendingWarningNotices(client).catch((err) => {
				console.error("[Modération] Notification d'avertissement échouée :", err);
			});
			deliverDueReminders(client).catch((err) => {
				console.error("[Rappels] Livraison échouée :", err);
			});
			raid.applyPendingLockdowns(client).catch((err) => {
				console.error("[Raid] Application des confinements échouée :", err);
			});
			raid.applyPendingResolutions(client).catch((err) => {
				console.error("[Raid] Levée des confinements échouée :", err);
			});
			quarantine.synchroniserQuarantaines(client).catch((err) => {
				console.error("[Quarantaine] Mise à jour des rôles échouée :", err);
			});
			checkPendingAccountFlagAlerts(client).catch((err) => {
				console.error("[Signalements] Alerte au staff échouée :", err);
			});
			giveaway.publishPending(client).catch((err) => {
				console.error("[Giveaway] Publication des concours échouée :", err);
			});
			giveaway.syncEdited(client).catch((err) => {
				console.error("[Giveaway] Édition des concours échouée :", err);
			});
			giveaway.applyCancellations(client).catch((err) => {
				console.error("[Giveaway] Annulation des concours échouée :", err);
			});
			giveaway.closeExpired(client).catch((err) => {
				console.error("[Giveaway] Clôture des concours échouée :", err);
			});
			giveaway.applyRerolls(client).catch((err) => {
				console.error("[Giveaway] Nouveaux tirages échoués :", err);
			});
			checkPendingEmbeds(client).catch((err) => {
				console.error("[Embeds] Envoi des messages échoué :", err);
			});
			// Un salon de creation ajoute depuis le dashboard n'existe pas encore
			// sur Discord : sans ce rattrapage, il fallait lancer `/create_parties`
			// a la main pour que le reglage prenne effet. L'operation ne cree que
			// les salons manquants, elle est donc sans effet le reste du temps.
			for (const guild of client.guilds.cache.values()) {
				voiceHubs.creerSalonsDeCreation(guild).catch((err) => {
					console.error(
						`[Vocaux] Création des salons de création échouée sur ${guild.name} :`,
						err,
					);
				});
			}
		}, DISCORD_SYNC_INTERVAL_MS);

		setInterval(() => {
			for (const guild of client.guilds.cache.values()) {
				xpRewards.reconcileGuild(guild).catch((err) => {
					console.error(
						`[XP] Rattrapage des paliers échoué sur ${guild.name} :`,
						err,
					);
				});
			}
		}, XP_REWARD_SYNC_INTERVAL_MS);
	},
};

export = event;
