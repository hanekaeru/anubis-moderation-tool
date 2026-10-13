import type { Client, Guild, GuildTextBasedChannel, Message } from "discord.js";
import {
	buildEsportResultEmbed,
	buildEsportWeekEmbed,
	DEFAULT_ESPORT_COLOR,
	DEFAULT_ESPORT_TITLE,
	type EsportEmbedMatch,
	type EsportEmbedSettings,
} from "@anubis/shared";
import type { EsportConfig, EsportMatch, EsportTeam } from "@anubis/shared/prisma";
import prisma from "../prisma";

/**
 * Publication des recapitulatifs esport et des annonces de resultat.
 *
 * Meme patron que les messages composes (`embedSync.ts`) : l'API met en file
 * (`discordSyncedAt` / `resultSyncedAt` a `null`), ce passage applique.
 * `messageId` renseigne signifie « corrige l'existant », `null` « publie ».
 * Un message introuvable (supprime a la main) est republie : l'annonce doit
 * exister quelque part.
 *
 * Trois points a garder :
 * - un echec pose **quand meme** la date, avec l'erreur : sans cela un message
 *   refuse serait rejoue toutes les cinq secondes. Le staff relance l'envoi
 *   depuis le dashboard une fois la cause corrigee.
 * - une correction ne remet **aucune mention** : seul le premier envoi
 *   interpelle le role, Discord ne notifiant de toute facon pas une edition.
 * - le retrait ne passe que par `removalRequestedAt`, pose par un
 *   administrateur. Supprimer une semaine ou un match du dashboard laisse
 *   Discord intact.
 */

type MatchRow = EsportMatch & { teamA: EsportTeam | null; teamB: EsportTeam | null };

const MATCH_INCLUDE = { teamA: true, teamB: true } as const;

function settings(config: EsportConfig | null): EsportEmbedSettings {
	return {
		title: config?.title ?? DEFAULT_ESPORT_TITLE,
		color: config?.color ?? DEFAULT_ESPORT_COLOR,
		spoilerScores: config?.spoilerScores ?? true,
	};
}

function embedMatch(row: MatchRow): EsportEmbedMatch {
	return {
		teamA: row.teamA,
		teamB: row.teamB,
		competition: row.competition,
		scheduledAt: row.scheduledAt,
		bestOf: row.bestOf,
		streamUrl: row.streamUrl,
		finished: row.finishedAt !== null,
		scoreA: row.scoreA,
		scoreB: row.scoreB,
		spoiler: row.spoiler,
	};
}

async function salon(guild: Guild, channelId: string | null): Promise<GuildTextBasedChannel | null> {
	if (!channelId) return null;
	const trouve = await guild.channels.fetch(channelId).catch(() => null);
	return trouve?.isTextBased() ? trouve : null;
}

async function messageExistant(
	guild: Guild,
	channelId: string | null,
	messageId: string | null,
): Promise<Message | null> {
	if (!messageId) return null;
	const cible = await salon(guild, channelId);
	return cible ? cible.messages.fetch(messageId).catch(() => null) : null;
}

function raison(err: unknown): string {
	return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

/** Mention du role choisi, seulement au premier envoi et si le reglage le veut. */
function mention(roleId: string | null, active: boolean) {
	return roleId && active
		? { content: `<@&${roleId}>`, allowedMentions: { roles: [roleId] } }
		: { allowedMentions: { parse: [] as [] } };
}

export async function synchroniserEsport(client: Client): Promise<void> {
	await retirerRecapitulatifs(client);
	await retirerResultats(client);
	await publierRecapitulatifs(client);
	await publierResultats(client);
}

async function retirerRecapitulatifs(client: Client): Promise<void> {
	const semaines = await prisma.esportWeek.findMany({
		where: { removalRequestedAt: { not: null } },
	});

	for (const semaine of semaines) {
		const guild = client.guilds.cache.get(semaine.guildId);
		if (!guild) continue;

		try {
			const message = await messageExistant(guild, semaine.channelId, semaine.messageId);
			await message?.delete();

			// La semaine redevient un brouillon : elle peut etre renvoyee.
			await prisma.esportWeek.update({
				where: { id: semaine.id },
				data: {
					messageId: null,
					channelId: null,
					publishRequestedAt: null,
					removalRequestedAt: null,
					discordSyncedAt: new Date(),
					lastError: null,
				},
			});
		} catch (err) {
			console.error(`[Esport] Retrait du récapitulatif ${semaine.id} échoué :`, err);
			await prisma.esportWeek
				.update({
					where: { id: semaine.id },
					data: { removalRequestedAt: null, discordSyncedAt: new Date(), lastError: raison(err) },
				})
				.catch(() => undefined);
		}
	}
}

async function retirerResultats(client: Client): Promise<void> {
	const matchs = await prisma.esportMatch.findMany({
		where: { resultRemovalRequestedAt: { not: null } },
		include: { week: { select: { guildId: true } } },
	});

	for (const match of matchs) {
		const guild = client.guilds.cache.get(match.week.guildId);
		if (!guild) continue;

		try {
			const message = await messageExistant(guild, match.resultChannelId, match.resultMessageId);
			await message?.delete();

			await prisma.esportMatch.update({
				where: { id: match.id },
				data: {
					resultMessageId: null,
					resultChannelId: null,
					resultRemovalRequestedAt: null,
					resultSyncedAt: new Date(),
					resultError: null,
				},
			});
		} catch (err) {
			console.error(`[Esport] Retrait du résultat ${match.id} échoué :`, err);
			await prisma.esportMatch
				.update({
					where: { id: match.id },
					data: {
						resultRemovalRequestedAt: null,
						resultSyncedAt: new Date(),
						resultError: raison(err),
					},
				})
				.catch(() => undefined);
		}
	}
}

async function publierRecapitulatifs(client: Client): Promise<void> {
	const semaines = await prisma.esportWeek.findMany({
		where: {
			publishRequestedAt: { not: null },
			discordSyncedAt: null,
			removalRequestedAt: null,
		},
		include: { matches: { include: MATCH_INCLUDE, orderBy: { scheduledAt: "asc" } } },
		orderBy: { updatedAt: "asc" },
		take: 10,
	});

	for (const semaine of semaines) {
		const guild = client.guilds.cache.get(semaine.guildId);
		if (!guild) continue;

		try {
			const config = await prisma.esportConfig.findUnique({ where: { guildId: guild.id } });
			const embed = buildEsportWeekEmbed(
				{
					weekStart: semaine.weekStart.toISOString().slice(0, 10),
					title: semaine.title,
					description: semaine.description,
					matches: semaine.matches.map(embedMatch),
				},
				settings(config),
			);

			const existant = await messageExistant(guild, semaine.channelId, semaine.messageId);
			if (existant) {
				await existant.edit({ embeds: [embed] });
				await prisma.esportWeek.update({
					where: { id: semaine.id },
					data: { discordSyncedAt: new Date(), lastError: null },
				});
				continue;
			}

			const cible = await salon(guild, config?.channelId ?? null);
			if (!cible) throw new Error("Salon de publication introuvable ou non textuel.");

			const message = await cible.send({
				...mention(config?.mentionRoleId ?? null, config?.mentionOnPublish ?? true),
				embeds: [embed],
			});

			await prisma.esportWeek.update({
				where: { id: semaine.id },
				data: {
					messageId: message.id,
					channelId: cible.id,
					publishedAt: semaine.publishedAt ?? new Date(),
					discordSyncedAt: new Date(),
					lastError: null,
				},
			});
		} catch (err) {
			console.error(`[Esport] Publication de la semaine ${semaine.id} échouée :`, err);
			await prisma.esportWeek
				.update({
					where: { id: semaine.id },
					data: { discordSyncedAt: new Date(), lastError: raison(err) },
				})
				.catch(() => undefined);
		}
	}
}

async function publierResultats(client: Client): Promise<void> {
	const matchs = await prisma.esportMatch.findMany({
		where: {
			finishedAt: { not: null },
			resultSyncedAt: null,
			resultRemovalRequestedAt: null,
		},
		include: { ...MATCH_INCLUDE, week: { select: { guildId: true } } },
		orderBy: { finishedAt: "asc" },
		take: 10,
	});

	for (const match of matchs) {
		const guild = client.guilds.cache.get(match.week.guildId);
		if (!guild) continue;

		try {
			const config = await prisma.esportConfig.findUnique({ where: { guildId: guild.id } });
			const embed = buildEsportResultEmbed(embedMatch(match), settings(config));

			const existant = await messageExistant(guild, match.resultChannelId, match.resultMessageId);
			if (existant) {
				await existant.edit({ embeds: [embed] });
				await prisma.esportMatch.update({
					where: { id: match.id },
					data: { resultSyncedAt: new Date(), resultError: null },
				});
				continue;
			}

			const cible = await salon(guild, config?.resultsChannelId ?? config?.channelId ?? null);
			if (!cible) throw new Error("Salon des résultats introuvable ou non textuel.");

			const message = await cible.send({
				...mention(config?.mentionRoleId ?? null, config?.mentionOnResult ?? false),
				embeds: [embed],
			});

			await prisma.esportMatch.update({
				where: { id: match.id },
				data: {
					resultMessageId: message.id,
					resultChannelId: cible.id,
					resultSyncedAt: new Date(),
					resultError: null,
				},
			});
		} catch (err) {
			console.error(`[Esport] Annonce du résultat ${match.id} échouée :`, err);
			await prisma.esportMatch
				.update({
					where: { id: match.id },
					data: { resultSyncedAt: new Date(), resultError: raison(err) },
				})
				.catch(() => undefined);
		}
	}
}
