import {
	EmbedBuilder,
	type Client,
	type Guild,
	type GuildTextBasedChannel,
} from "discord.js";
import { EmbedMessageStatus, type EmbedFieldDto } from "@anubis/shared";
import type { EmbedMessage } from "@anubis/shared/prisma";
import prisma from "../prisma";

/**
 * Publication des messages composes depuis le dashboard.
 *
 * Meme patron `discordSyncedAt` que les concours : la webapp ecrit la ligne
 * avec le statut `QUEUED`, le bot repasse et applique l'effet reel. Le statut
 * de sortie dit ce qui s'est passe — `SENT` quand Discord a accepte, `FAILED`
 * avec la raison sinon.
 *
 * Un message deja publie (`messageId` renseigne) est **corrige**, pas
 * republie : c'est ce qui permet de rattraper une faute de frappe dans une
 * annonce sans la poster deux fois. Le message n'est republie que si Discord ne
 * le retrouve plus — il a alors ete supprime a la main.
 */

/**
 * Discord refuse un champ dont le nom ou la valeur est vide.
 *
 * Les DTO de l'API l'interdisent deja, mais la colonne est du JSON libre : une
 * ligne ecrite avant que la regle n'existe ferait echouer tout l'envoi pour un
 * champ vide oublie.
 */
function usableFields(value: unknown): EmbedFieldDto[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry) => {
		if (!entry || typeof entry !== "object") return [];

		const field = entry as Record<string, unknown>;
		if (typeof field.name !== "string" || typeof field.value !== "string") return [];
		if (!field.name.trim() || !field.value.trim()) return [];

		return [
			{ name: field.name, value: field.value, inline: field.inline === true },
		];
	});
}

function buildEmbed(row: EmbedMessage): EmbedBuilder {
	const embed = new EmbedBuilder().setColor(row.color);

	if (row.title) embed.setTitle(row.title);
	if (row.description) embed.setDescription(row.description);
	// `setURL` n'a d'effet que sur un embed qui porte un titre : c'est le titre
	// que Discord rend cliquable.
	if (row.url && row.title) embed.setURL(row.url);
	if (row.authorName) {
		embed.setAuthor({
			name: row.authorName,
			...(row.authorIconUrl ? { iconURL: row.authorIconUrl } : {}),
		});
	}
	if (row.thumbnailUrl) embed.setThumbnail(row.thumbnailUrl);
	if (row.imageUrl) embed.setImage(row.imageUrl);
	if (row.footerText) {
		embed.setFooter({
			text: row.footerText,
			...(row.footerIconUrl ? { iconURL: row.footerIconUrl } : {}),
		});
	}
	if (row.showTimestamp) embed.setTimestamp();

	const fields = usableFields(row.fields);
	if (fields.length) embed.addFields(fields);

	return embed;
}

async function fetchChannel(
	guild: Guild,
	channelId: string,
): Promise<GuildTextBasedChannel | null> {
	const channel = await guild.channels.fetch(channelId).catch(() => null);
	return channel?.isTextBased() ? channel : null;
}

/**
 * Raison lisible d'un echec.
 *
 * Elle est affichee telle quelle dans le dashboard : « salon introuvable » ou
 * « permissions manquantes » se corrige, une trace de pile ne se corrige pas.
 */
function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

async function markFailed(id: string, reason: string): Promise<void> {
	await prisma.embedMessage.update({
		where: { id },
		data: {
			status: EmbedMessageStatus.FAILED,
			lastError: reason.slice(0, 500),
			// Pose malgre l'echec : sans cela, le message serait rejoue toutes les
			// cinq secondes indefiniment. C'est au staff de le remettre en file
			// apres correction.
			discordSyncedAt: new Date(),
		},
	});
}

async function deliver(client: Client, row: EmbedMessage): Promise<void> {
	const guild = client.guilds.cache.get(row.guildId);
	if (!guild) {
		await markFailed(row.id, "Serveur introuvable.");
		return;
	}

	const channel = await fetchChannel(guild, row.channelId);
	if (!channel) {
		await markFailed(row.id, "Salon introuvable ou non textuel.");
		return;
	}

	const payload = {
		content: row.content ?? undefined,
		embeds: [buildEmbed(row)],
	};

	// Message deja publie : on corrige l'existant. Introuvable (supprime a la
	// main), on republie — l'annonce doit exister quelque part.
	if (row.messageId) {
		const existing = await channel.messages
			.fetch(row.messageId)
			.catch(() => null);

		if (existing) {
			await existing.edit(payload);
			await prisma.embedMessage.update({
				where: { id: row.id },
				data: {
					status: EmbedMessageStatus.SENT,
					discordSyncedAt: new Date(),
					lastError: null,
				},
			});
			return;
		}
	}

	const message = await channel.send(payload);

	await prisma.embedMessage.update({
		where: { id: row.id },
		data: {
			messageId: message.id,
			status: EmbedMessageStatus.SENT,
			sentAt: row.sentAt ?? new Date(),
			discordSyncedAt: new Date(),
			lastError: null,
		},
	});
}

/** Publie ou corrige les messages mis en file depuis le dashboard. */
export async function checkPendingEmbeds(client: Client): Promise<void> {
	const pending = await prisma.embedMessage.findMany({
		where: { status: EmbedMessageStatus.QUEUED, discordSyncedAt: null },
		orderBy: { updatedAt: "asc" },
	});

	for (const row of pending) {
		try {
			await deliver(client, row);
		} catch (err) {
			console.error(`[Embeds] Envoi du message ${row.id} échoué :`, err);
			await markFailed(row.id, describeError(err)).catch(() => undefined);
		}
	}
}
