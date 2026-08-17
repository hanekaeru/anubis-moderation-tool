import {
	EmbedBuilder,
	type Client,
	type Guild,
	type GuildTextBasedChannel,
	type Message,
	type MessageReaction,
	type PartialMessageReaction,
	type PartialUser,
	type User,
} from "discord.js";
import { GiveawayStatus, type GiveawayStatus as GiveawayStatusType } from "@anubis/shared";
import type { Giveaway } from "@anubis/shared/prisma";
import * as colors from "../utils/constantes";
import prisma from "../prisma";
import * as referentiel from "./referentiel";

/**
 * Concours a participation par reaction.
 *
 * **Deux modes complementaires**, comme le referentiel : les reactions sont
 * enregistrees au fil de l'eau par les evenements `messageReactionAdd` /
 * `messageReactionRemove`, et la liste complete est relue sur le message au
 * moment du tirage. Le second rattrape ce que le premier a manque — une
 * reaction posee bot eteint ne genere aucun evenement, et c'est precisement au
 * tirage qu'elle doit compter.
 *
 * Le cycle de vie suit le patron `discordSyncedAt` deja utilise pour les
 * sanctions et les tickets : une ecriture web le laisse a `null`, le bot
 * repasse, applique l'effet reel puis le pose. Le statut dit **ce qui** reste a
 * faire :
 *
 * - `SCHEDULED` + `null` : l'embed n'a jamais ete publie.
 * - `RUNNING` + `null` : l'embed publie ne reflete plus la ligne (edition web).
 * - `CANCELLED` + `null` : le message doit etre barre.
 * - `ENDED` + `null` : un nouveau tirage a ete demande.
 */

/** Emojis Unicode compares apres normalisation : Discord renvoie parfois la variante VS16. */
function normalizeEmoji(emoji: string): string {
	return emoji.replace(/️/g, "");
}

/**
 * Vrai quand la reaction posee est celle du concours.
 *
 * Un emoji personnalise est identifie par son identifiant, jamais par son nom :
 * deux serveurs peuvent avoir un `:tada:` different, et un emoji renomme
 * casserait la comparaison.
 */
function matchesEmoji(reaction: MessageReaction | PartialMessageReaction, configured: string): boolean {
	const custom = configured.match(/^<a?:[a-zA-Z0-9_]{2,32}:(\d{17,20})>$/);
	if (custom) return reaction.emoji.id === custom[1];

	return normalizeEmoji(reaction.emoji.name ?? "") === normalizeEmoji(configured);
}

function statusLine(status: GiveawayStatusType, endsAt: Date): string {
	switch (status) {
		case GiveawayStatus.CANCELLED:
			return "**Concours annulé.**";
		case GiveawayStatus.ENDED:
			return "**Concours terminé.**";
		default:
			// Horodatage relatif Discord : chaque membre le lit dans son fuseau,
			// et il se met a jour tout seul sans que le bot reedite le message.
			return `Fin <t:${Math.floor(endsAt.getTime() / 1000)}:R> (<t:${Math.floor(endsAt.getTime() / 1000)}:f>)`;
	}
}

function buildEmbed(giveaway: Giveaway, winners: string[] = []): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setTitle(`🎁 ${giveaway.title}`)
		.setColor(
			giveaway.status === GiveawayStatus.CANCELLED
				? colors.danger
				: giveaway.status === GiveawayStatus.ENDED
					? colors.info
					: colors.success,
		)
		.addFields(
			{ name: "Lot", value: giveaway.prize },
			{
				name: "Gagnant(s)",
				value: String(giveaway.winnerCount),
				inline: true,
			},
		)
		.setFooter({
			text:
				giveaway.status === GiveawayStatus.RUNNING
					? `Réagis avec ${giveaway.reactionEmoji} pour participer`
					: "Concours clos",
		})
		.setTimestamp(giveaway.endsAt);

	if (giveaway.description) embed.setDescription(giveaway.description);
	if (giveaway.imageUrl) embed.setImage(giveaway.imageUrl);

	embed.addFields({ name: "​", value: statusLine(giveaway.status, giveaway.endsAt) });

	if (winners.length) {
		embed.addFields({
			name: winners.length > 1 ? "Gagnants" : "Gagnant",
			value: winners.map((id) => `<@${id}>`).join(", "),
		});
	}

	return embed;
}

async function fetchChannel(
	guild: Guild,
	channelId: string,
): Promise<GuildTextBasedChannel | null> {
	const channel = await guild.channels.fetch(channelId).catch(() => null);
	return channel?.isTextBased() ? channel : null;
}

async function fetchMessage(client: Client, giveaway: Giveaway): Promise<Message | null> {
	if (!giveaway.messageId) return null;

	const guild = client.guilds.cache.get(giveaway.guildId);
	if (!guild) return null;

	const channel = await fetchChannel(guild, giveaway.channelId);
	if (!channel) return null;

	return channel.messages.fetch(giveaway.messageId).catch(() => null);
}

/**
 * Publie l'embed d'un concours et ouvre les participations.
 *
 * Exportee parce que `/giveaway` l'appelle directement : la commande vient de
 * creer la ligne et tient deja le client, elle n'a aucune raison d'attendre le
 * prochain passage de la tache periodique pour afficher son propre concours.
 */
export async function publishOne(client: Client, giveaway: Giveaway): Promise<boolean> {
	const guild = client.guilds.cache.get(giveaway.guildId);
	const channel = guild ? await fetchChannel(guild, giveaway.channelId) : null;

	if (!channel) {
		// Salon introuvable : le concours ne peut pas exister cote Discord.
		// L'annuler vaut mieux que de le laisser eternellement en attente.
		await prisma.giveaway.update({
			where: { id: giveaway.id },
			data: { status: GiveawayStatus.CANCELLED, discordSyncedAt: new Date() },
		});
		console.error(`[Giveaway] Salon ${giveaway.channelId} introuvable, concours annulé.`);
		return false;
	}

	try {
		const message = await channel.send({ embeds: [buildEmbed(giveaway)] });
		await message.react(giveaway.reactionEmoji);

		await prisma.giveaway.update({
			where: { id: giveaway.id },
			data: {
				messageId: message.id,
				status: GiveawayStatus.RUNNING,
				discordSyncedAt: new Date(),
			},
		});
		return true;
	} catch (err) {
		console.error(`[Giveaway] Publication du concours ${giveaway.id} échouée :`, err);
		return false;
	}
}

/** Publie les concours enregistres depuis la webapp mais jamais annonces. */
export async function publishPending(client: Client): Promise<void> {
	const pending = await prisma.giveaway.findMany({
		where: { status: GiveawayStatus.SCHEDULED, discordSyncedAt: null },
	});

	for (const giveaway of pending) {
		await publishOne(client, giveaway);
	}
}

/** Repercute sur l'embed une modification faite depuis la webapp. */
export async function syncEdited(client: Client): Promise<void> {
	const pending = await prisma.giveaway.findMany({
		where: {
			status: GiveawayStatus.RUNNING,
			discordSyncedAt: null,
			messageId: { not: null },
		},
	});

	for (const giveaway of pending) {
		const message = await fetchMessage(client, giveaway);

		if (message) {
			await message.edit({ embeds: [buildEmbed(giveaway)] }).catch((err) => {
				console.error(`[Giveaway] Édition du concours ${giveaway.id} échouée :`, err);
			});

			// La reaction a pu changer : poser la nouvelle sans retirer l'ancienne,
			// pour ne pas effacer les participations deja enregistrees.
			await message.react(giveaway.reactionEmoji).catch(() => undefined);
		}

		await prisma.giveaway.update({
			where: { id: giveaway.id },
			data: { discordSyncedAt: new Date() },
		});
	}
}

/** Barre le message d'un concours annule depuis la webapp. */
export async function applyCancellations(client: Client): Promise<void> {
	const pending = await prisma.giveaway.findMany({
		where: { status: GiveawayStatus.CANCELLED, discordSyncedAt: null },
	});

	for (const giveaway of pending) {
		const message = await fetchMessage(client, giveaway);

		if (message) {
			await message
				.edit({ embeds: [buildEmbed(giveaway)] })
				.catch((err) => console.error(`[Giveaway] Annulation ${giveaway.id} échouée :`, err));
		}

		await prisma.giveaway.update({
			where: { id: giveaway.id },
			data: { discordSyncedAt: new Date() },
		});
	}
}

/**
 * Relit la liste complete des participants sur le message.
 *
 * C'est le rattrapage : `messageReactionAdd` n'a rien livre pendant que le bot
 * etait eteint, et une participation manquee au tirage est une participation
 * perdue. `upsertUser` precede l'insertion parce que `giveaway_entries` porte
 * une cle etrangere vers `discord_users` — un participant jamais croise par le
 * referentiel ferait echouer le lot entier.
 */
async function reconcileEntries(message: Message, giveaway: Giveaway): Promise<void> {
	const reaction = message.reactions.cache.find((candidate) =>
		matchesEmoji(candidate, giveaway.reactionEmoji),
	);
	if (!reaction) return;

	const users = await reaction.users.fetch().catch(() => null);
	if (!users) return;

	for (const user of users.values()) {
		if (user.bot) continue;

		try {
			await referentiel.upsertUser(user);
			await prisma.giveawayEntry.upsert({
				where: { giveawayId_userId: { giveawayId: giveaway.id, userId: user.id } },
				update: {},
				create: { giveawayId: giveaway.id, userId: user.id },
			});
		} catch (err) {
			console.error(`[Giveaway] Participation de ${user.id} non enregistrée :`, err);
		}
	}
}

/** Tirage sans remise : un participant ne peut pas gagner deux lots. */
function drawWinners(userIds: string[], count: number): string[] {
	const pool = [...userIds];
	const winners: string[] = [];

	while (winners.length < count && pool.length) {
		const index = Math.floor(Math.random() * pool.length);
		winners.push(pool.splice(index, 1)[0]!);
	}

	return winners;
}

async function announce(
	client: Client,
	giveaway: Giveaway,
	winners: string[],
): Promise<void> {
	const guild = client.guilds.cache.get(giveaway.guildId);
	if (!guild) return;

	// Le salon d'annonce est un reglage : a defaut, l'annonce tombe la ou le
	// concours a ete publie, qui reste le choix le moins surprenant.
	const channel = await fetchChannel(guild, giveaway.announceChannelId ?? giveaway.channelId);
	if (!channel) return;

	const embed = new EmbedBuilder()
		.setTitle(`🎉 Résultat — ${giveaway.title}`)
		.setColor(winners.length ? colors.success : colors.warning)
		.addFields({ name: "Lot", value: giveaway.prize })
		.setTimestamp();

	if (giveaway.imageUrl) embed.setThumbnail(giveaway.imageUrl);

	if (winners.length) {
		embed.addFields({
			name: winners.length > 1 ? "Gagnants" : "Gagnant",
			value: winners.map((id) => `<@${id}>`).join("\n"),
		});
	} else {
		embed.setDescription("Aucune participation : pas de gagnant.");
	}

	await channel
		.send({
			content: winners.length ? winners.map((id) => `<@${id}>`).join(" ") : undefined,
			embeds: [embed],
		})
		.catch((err: unknown) =>
			console.error(`[Giveaway] Annonce du concours ${giveaway.id} échouée :`, err),
		);
}

/**
 * Procede au tirage et annonce le resultat.
 *
 * Partage par la cloture normale et par le nouveau tirage demande depuis la
 * webapp : les deux font exactement la meme chose, seule l'origine differe.
 */
async function drawAndAnnounce(client: Client, giveaway: Giveaway): Promise<void> {
	const message = await fetchMessage(client, giveaway);
	if (message) await reconcileEntries(message, giveaway);

	const entries = await prisma.giveawayEntry.findMany({
		where: { giveawayId: giveaway.id },
		select: { userId: true },
	});

	const winners = drawWinners(
		entries.map((entry) => entry.userId),
		giveaway.winnerCount,
	);

	const ended = await prisma.$transaction(async (tx) => {
		if (winners.length) {
			await tx.giveawayEntry.updateMany({
				where: { giveawayId: giveaway.id, userId: { in: winners } },
				data: { isWinner: true },
			});
		}

		return tx.giveaway.update({
			where: { id: giveaway.id },
			data: {
				status: GiveawayStatus.ENDED,
				endedAt: new Date(),
				discordSyncedAt: new Date(),
			},
		});
	});

	if (message) {
		await message.edit({ embeds: [buildEmbed(ended, winners)] }).catch(() => undefined);
	}

	await announce(client, ended, winners);
}

/** Cloture les concours arrives a echeance. */
export async function closeExpired(client: Client): Promise<void> {
	const expired = await prisma.giveaway.findMany({
		where: { status: GiveawayStatus.RUNNING, endsAt: { lte: new Date() } },
	});

	for (const giveaway of expired) {
		try {
			await drawAndAnnounce(client, giveaway);
		} catch (err) {
			console.error(`[Giveaway] Clôture du concours ${giveaway.id} échouée :`, err);
		}
	}
}

/**
 * Rejoue un tirage demande depuis la webapp.
 *
 * `GiveawayService.reroll` efface les gagnants, remet `endedAt` a `null` et
 * `discordSyncedAt` a `null` : c'est cette combinaison, sur un concours deja
 * `ENDED`, qui distingue un nouveau tirage d'un concours simplement termine.
 */
export async function applyRerolls(client: Client): Promise<void> {
	const pending = await prisma.giveaway.findMany({
		where: { status: GiveawayStatus.ENDED, discordSyncedAt: null },
	});

	for (const giveaway of pending) {
		try {
			await drawAndAnnounce(client, giveaway);
		} catch (err) {
			console.error(`[Giveaway] Nouveau tirage du concours ${giveaway.id} échoué :`, err);
			// Sans cela, un tirage qui echoue serait rejoue toutes les cinq
			// secondes indefiniment.
			await prisma.giveaway.update({
				where: { id: giveaway.id },
				data: { discordSyncedAt: new Date() },
			});
		}
	}
}

/** Concours en cours portant ce message, ou `null` si le message n'en est pas un. */
async function runningGiveawayForMessage(messageId: string): Promise<Giveaway | null> {
	return prisma.giveaway.findFirst({
		where: { messageId, status: GiveawayStatus.RUNNING },
	});
}

export async function recordReaction(
	reaction: MessageReaction | PartialMessageReaction,
	user: User | PartialUser,
): Promise<void> {
	if (user.bot) return;

	const giveaway = await runningGiveawayForMessage(reaction.message.id);
	if (!giveaway || !matchesEmoji(reaction, giveaway.reactionEmoji)) return;

	// Le concours peut avoir expire sans que la tache de cloture soit encore
	// passee : accepter la participation serait accepter un retardataire.
	if (giveaway.endsAt.getTime() <= Date.now()) return;

	const full = user.partial ? await user.fetch().catch(() => null) : user;
	if (!full) return;

	await referentiel.upsertUser(full);
	await prisma.giveawayEntry.upsert({
		where: { giveawayId_userId: { giveawayId: giveaway.id, userId: full.id } },
		update: {},
		create: { giveawayId: giveaway.id, userId: full.id },
	});
}

export async function removeReaction(
	reaction: MessageReaction | PartialMessageReaction,
	user: User | PartialUser,
): Promise<void> {
	if (user.bot) return;

	const giveaway = await runningGiveawayForMessage(reaction.message.id);
	if (!giveaway || !matchesEmoji(reaction, giveaway.reactionEmoji)) return;

	await prisma.giveawayEntry.deleteMany({
		where: { giveawayId: giveaway.id, userId: user.id },
	});
}
