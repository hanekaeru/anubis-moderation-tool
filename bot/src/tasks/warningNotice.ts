import { EmbedBuilder, type Client } from "discord.js";
import { WARNING_SEVERITY_LABELS } from "@anubis/shared";
import prisma from "../prisma";
import * as colors from "../utils/constantes";

/**
 * Previent sur Discord un membre averti depuis la webapp.
 *
 * `/warn` envoie le message prive lui-meme et pose `discordSyncedAt` dans la
 * foulee ; `POST /warnings` ne touche qu'a la base et le laisse `null`. Sans
 * ce rattrapage, un avertissement pose depuis le dashboard n'etait jamais
 * annonce a l'interesse — la sanction, elle, l'etait deja.
 *
 * Meme patron que `sanctionSync.ts` et `ticketSync.ts`.
 */

/**
 * Un membre parti, aux messages prives fermes ou ayant bloque le bot n'est pas
 * joignable. La date est posee malgre tout : sans cela l'avertissement
 * reviendrait a chaque passage, toutes les cinq secondes, indefiniment.
 */
export async function checkPendingWarningNotices(client: Client): Promise<void> {
	const pending = await prisma.warning.findMany({
		where: { discordSyncedAt: null, revokedAt: null },
		include: { user: true },
		// Borne de securite : un incident qui aurait laisse mille lignes en
		// attente ne doit pas tenir la boucle de synchronisation pendant une
		// minute. Le reste part au passage suivant.
		take: 25,
		orderBy: { createdAt: "asc" },
	});

	for (const warning of pending) {
		const guild = client.guilds.cache.get(warning.guildId);

		if (guild) {
			const user = await client.users.fetch(warning.userId).catch(() => null);

			if (user) {
				const embed = new EmbedBuilder()
					.setColor(colors.warning)
					.setTitle("Anubis - Nouvel avertissement")
					.setDescription(
						`Tu as reçu un avertissement sur **${guild.name}**.\nMotif : ${warning.reason}`,
					)
					.addFields({
						name: "Gravité",
						value: WARNING_SEVERITY_LABELS[warning.severity],
						inline: true,
					})
					.setTimestamp(warning.createdAt)
					.setFooter({
						text: "En cas de problème, vous pouvez ouvrir un ticket ou en parler aux administrateurs.",
					});

				await user.send({ embeds: [embed] }).catch(() => undefined);
			}
		}

		await prisma.warning.update({
			where: { id: warning.id },
			data: { discordSyncedAt: new Date() },
		});
	}
}
