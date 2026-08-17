import { Events } from "discord.js";
import type { BotEvent } from "../types";
import prisma from "../prisma";
import * as voice from "../collectors/voice";
import * as voiceHubs from "../collectors/voiceHubs";
import * as voiceLog from "../collectors/voiceLog";

const event: BotEvent<typeof Events.VoiceStateUpdate> = {
	name: Events.VoiceStateUpdate,
	once: false,
	async execute(oldState, newState) {
		const avant = oldState.channelId;
		const apres = newState.channelId;
		// Micro coupe, casque coupe, partage d'ecran : rien a faire.
		if (avant === apres) return;

		try {
			const hub = apres
				? await voiceHubs.trouverHub(newState.guild.id, apres)
				: null;

			await voice.enregistrerMouvement(oldState, newState, {
				sasDArrivee: hub !== null,
			});

			// Apres la fermeture de session, sinon le partant compterait encore
			// parmi les occupants et le dernier salon ne serait jamais supprime.
			if (avant) {
				const quitte = await prisma.temporaryVoiceChannel.findFirst({
					where: { channelId: avant, closedAt: null },
					select: { name: true },
				});

				await voiceHubs.quitterSalonTemporaire(
					oldState.guild,
					avant,
					oldState.id,
				);

				if (quitte) {
					await voiceLog.membreParti(
						oldState.guild,
						avant,
						quitte.name,
						oldState.id,
					);
				}
			}

			if (hub) {
				await voiceHubs.accueillirDansHub(hub, newState);
				return;
			}

			if (apres && newState.channel) {
				const rejoint = await prisma.temporaryVoiceChannel.findFirst({
					where: { channelId: apres, closedAt: null },
					select: { ownerId: true },
				});

				// L'arrivee du proprietaire est deja couverte par « salon cree ».
				if (rejoint && rejoint.ownerId !== newState.id) {
					await voiceLog.membreArrive(
						newState.guild,
						newState.channel,
						newState.id,
					);
				}
			}
		} catch (err) {
			console.error("[Vocal] Mouvement non enregistré :", err);
		}
	},
};

export = event;
