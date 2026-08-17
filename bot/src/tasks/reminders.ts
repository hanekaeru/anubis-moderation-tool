import { EmbedBuilder, type Client } from "discord.js";
import prisma from "../prisma";
import * as colors from "../utils/constantes";

/**
 * Livraison des rappels du staff arrives a echeance.
 *
 * Le rappel part en message prive : c'est un pense-bete personnel, pas une
 * annonce. Messages prives fermes, le salon d'origine sert de repli — un
 * rappel qu'on ne recoit pas ne sert a rien, et le silence serait pris pour un
 * bug de la commande.
 *
 * La ligne est marquee livree **dans tous les cas**, y compris quand les deux
 * chemins echouent : sans cela le rappel reviendrait toutes les cinq secondes
 * jusqu'a la fin des temps.
 */
export async function deliverDueReminders(client: Client): Promise<void> {
	const dus = await prisma.staffReminder.findMany({
		where: { deliveredAt: null, remindAt: { lte: new Date() } },
		orderBy: { remindAt: "asc" },
		take: 25,
	});

	for (const rappel of dus) {
		const embed = new EmbedBuilder()
			.setColor(colors.info)
			.setTitle("Anubis - Rappel")
			.setDescription(rappel.message)
			.setTimestamp(rappel.createdAt)
			.setFooter({ text: "Rappel que tu t'es posé" });

		if (rappel.targetId) {
			embed.addFields({
				name: "Membre concerné",
				value: `<@${rappel.targetId}>`,
				inline: true,
			});
		}

		const livre = await envoyerEnPrive(client, rappel.userId, embed);
		if (!livre) {
			await envoyerDansSalon(client, rappel.channelId, rappel.userId, embed);
		}

		await prisma.staffReminder.update({
			where: { id: rappel.id },
			data: { deliveredAt: new Date() },
		});
	}
}

async function envoyerEnPrive(
	client: Client,
	userId: string,
	embed: EmbedBuilder,
): Promise<boolean> {
	const user = await client.users.fetch(userId).catch(() => null);
	if (!user) return false;

	try {
		await user.send({ embeds: [embed] });
		return true;
	} catch {
		return false;
	}
}

async function envoyerDansSalon(
	client: Client,
	channelId: string,
	userId: string,
	embed: EmbedBuilder,
): Promise<void> {
	const channel = await client.channels.fetch(channelId).catch(() => null);
	if (!channel?.isTextBased() || !channel.isSendable()) return;

	await channel
		.send({ content: `<@${userId}>`, embeds: [embed] })
		.catch(() => undefined);
}
