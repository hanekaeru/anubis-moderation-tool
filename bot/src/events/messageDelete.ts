import { AuditLogEvent, EmbedBuilder, Events } from "discord.js";
import { LogChannelKey } from "@anubis/shared";
import type { BotEvent } from "../types";
import activite from "../collectors/activite";
import * as colors from "../utils/constantes";
import * as guildConfig from "../collectors/guildConfig";
import { chercherAction } from "../collectors/discordAudit";

const event: BotEvent<typeof Events.MessageDelete> = {
	name: Events.MessageDelete,
	once: false,
	async execute(message) {
		const editedMessageEmbed = new EmbedBuilder()
			.setColor(colors.danger)
			.setTitle(`Anubis - :wastebasket: Suppression d'un message`)
			.setTimestamp()
			.setFooter({
				text: "En cas de problème, vous pouvez ouvrir un ticket ou en parler aux administrateurs.",
			});

		if (!message?.guild || message.author?.bot) return;

		// Discord ne renvoie que l'identifiant pour un message absent du cache :
		// une suppression ancienne n'est donc pas comptabilisee, faute d'auteur.
		if (!message.author) return;

		activite.enregistrerSuppression(message);

		// Discord ne journalise une suppression que lorsqu'elle est faite par
		// quelqu'un d'autre que l'auteur : pas d'entree, message probablement
		// supprime par son propre auteur.
		const suppression = await chercherAction(message.guild, AuditLogEvent.MessageDelete, message.author.id);
		const supprimePar = suppression?.executorId
			? `<@${suppression.executorId}>`
			: `<@${message.author.id}> (auto-suppression probable)`;

		editedMessageEmbed
			.setDescription(`Auteur : <@${message.author.id}> | \`${message.author.username}\` | \`${message.author.id}\``)
			.addFields(
				{ name: "Contenu du message", value: message.content?.slice(0, 1000) || "(vide ou pièces jointes)" },
				{ name: "Supprimé par", value: supprimePar },
			);

		const attachments = [...message.attachments.values()];
		if (attachments.length > 0) {
			editedMessageEmbed.addFields({
				name: "Pièces jointes",
				value: attachments.map((attachment) => `[${attachment.name}](${attachment.url})`).join("\n").slice(0, 1024),
			});

			const image = attachments.find((attachment) => attachment.contentType?.startsWith("image/"));
			if (image) editedMessageEmbed.setImage(image.url);
		}
		const channelId = await guildConfig.getConfig(message.guild.id, LogChannelKey.MESSAGES);
		if (!channelId) return;

		const channel = await message.guild.channels.fetch(channelId).catch(() => null);
		if (!channel?.isTextBased()) return;

		await channel.send({ embeds: [editedMessageEmbed] }).catch(() => undefined);
	},
};

export = event;
