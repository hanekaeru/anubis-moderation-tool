import { EmbedBuilder, Events } from "discord.js";
import { LogChannelKey } from "@anubis/shared";
import type { BotEvent } from "../types";
import activite from "../collectors/activite";
import * as colors from "../utils/constantes";
import * as guildConfig from "../collectors/guildConfig";

const event: BotEvent<typeof Events.MessageUpdate> = {
	name: Events.MessageUpdate,
	once: false,
	async execute(ancien, nouveau) {
		const editedMessageEmbed = new EmbedBuilder()
			.setColor(colors.info)
			.setTitle(`Anubis - :pencil: Édition d'un message`)
			.setTimestamp()
			.setFooter({
				text: "En cas de problème, vous pouvez ouvrir un ticket ou en parler aux administrateurs.",
			});
		const message = nouveau ?? ancien;
		if (!message?.guild || message.author?.bot) return;

		// Un message hors cache arrive partiel : sans auteur, il n'y a personne
		// a qui attribuer l'edition.
		if (!message.author) return;

		// On enregistre l'activité au niveau base
		activite.enregistrerEdition(message);

		editedMessageEmbed
			.setDescription(`Auteur : <@${message.author.id}> | \`${message.author.username}\` | \`${message.author.id}\``)
			.addFields(
				{ name: "Message avant modification", value: ancien?.content?.slice(0, 1000) || "(vide ou non mis en cache)" },
				{ name: "Message après modification", value: message.content?.slice(0, 1000) || "(vide ou pièces jointes)" },
			);

		const attachments = [...ancien.attachments.values()];
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
