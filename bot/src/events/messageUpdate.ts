import { EmbedBuilder, Events } from "discord.js";
import { LogChannelKey } from "@anubis/shared";
import type { BotEvent } from "../types";
import activite from "../collectors/activite";
import * as colors from "../utils/constantes";
import * as guildConfig from "../collectors/guildConfig";
import { referenceMembre } from "../utils/mentions";

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

		// Discord emet `MessageUpdate` pour bien plus qu'une edition : c'est le
		// meme evenement qui annonce la resolution de l'apercu d'un lien
		// (Tenor, Giphy, toute URL), un epinglage ou une suppression d'apercu.
		// Envoyer un GIF remontait ainsi comme une « modification » une seconde
		// apres l'envoi. Seule une vraie edition pose `editedTimestamp`.
		if (!message.editedTimestamp) return;

		// `editedTimestamp` reste pose apres coup : l'apercu du lien ajoute par
		// une edition declenche un second `MessageUpdate`, celui-la avec un
		// horodatage d'edition deja renseigne. Le texte, lui, n'a pas bouge —
		// c'est ce qui distingue les deux. Comparaison seulement quand l'ancien
		// message etait en cache : partiel, son contenu est `null` et ne prouve
		// rien.
		if (ancien.content !== null && ancien.content === message.content) return;

		// On enregistre l'activité au niveau base
		activite.enregistrerEdition(message);

		// Le salon vient de `channelId`, toujours livre meme sur un message
		// partiel. Un message poste dans un fil mentionne le fil, pas le salon
		// parent — c'est bien la que la moderation doit aller regarder.
		editedMessageEmbed
			.setDescription(
				`Auteur : ${await referenceMembre(message.guild.id, message.author.id, message.author.username)}\n` +
					`Salon : <#${message.channelId}>`,
			)
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
