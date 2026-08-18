import {
	ChannelType,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import { LOG_CHANNEL_DESCRIPTIONS, LogChannelKey } from "@anubis/shared";
import type { Command } from "../../types";
import * as guildConfig from "../../collectors/guildConfig";

const LOGS_CATEGORY_NAME = "🗂️ • Banque de données";

const LOG_CHANNELS: { key: LogChannelKey; channelName: string, topic: string }[] = [
	{
		key: LogChannelKey.MODERATION,
		channelName: "🛡️・logs-modération",
		topic: "Ce channel permet de répertorier toutes les actions effectuées par la modération (sanctions, avertissement, ...)."
	}, {
		key: LogChannelKey.MEMBERS,
		channelName: "👤・logs-membres",
		topic: "Ce channel permet de répertorier toutes les actions effectuées par les membres (changement de nom, changement d'avatar, ...)."
	}, {
		key: LogChannelKey.MESSAGES,
		channelName: "💬・logs-messages",
		topic: "Ce channel permet de répertorier toutes les actions effectuées sur un message (suppression, modification)."
	}, {
		key: LogChannelKey.SERVER,
		channelName: "⚙️・logs-serveur",
		topic: "Ce channel permet de répertorier tout les départs et toutes les arrivées du serveur."
	}, {
		key: LogChannelKey.VOICE,
		channelName: "🔊・logs-vocaux",
		topic: "Ce channel permet de répertorier la vie des salons vocaux temporaires (création, arrivées, départs, propriétaire, signalements)."
	},
];

/**
 * Commande qui permet de générer les différents salons de logs sur le serveur et
 * qui permet également de pouvoir récupérer les identifiants de ces nouveaux
 * salons et de pouvoir les ajoutés comme config propre à la guild. Ces configs
 * sont accessibles depuis le dashboard web dans le menu "Configurations".
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("create_logs")
		.setDescription(
			"ADMIN - Commande pour créer les différents salons de logs.",
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;
		if (interaction.replied || interaction.deferred) return;

		if (
			!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
		) {
			await interaction.reply({
				content: "Tu n'as pas la permission de configurer le serveur.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (
			!interaction.guild.members.me?.permissions.has(
				PermissionFlagsBits.ManageChannels,
			)
		) {
			await interaction.reply({
				content:
					"Je n'ai pas la permission de gérer les salons sur ce serveur.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const { guild } = interaction;

		let category = guild.channels.cache.find(
			(channel) =>
				channel.type === ChannelType.GuildCategory &&
				channel.name.toLowerCase() === LOGS_CATEGORY_NAME.toLowerCase(),
		);

		if (!category) {
			category = await guild.channels.create({
				name: LOGS_CATEGORY_NAME,
				type: ChannelType.GuildCategory,
			});
		}

		const lignes: string[] = [];

		for (const { key, channelName, topic } of LOG_CHANNELS) {
			const existingId = await guildConfig.getConfig(guild.id, key);
			const existingChannel = existingId
				? await guild.channels.fetch(existingId).catch(() => null)
				: null;

			if (existingChannel) {
				lignes.push(`- ${existingChannel} (déjà configuré)`);
				continue;
			}

			const channel = await guild.channels.create({
				name: channelName,
				type: ChannelType.GuildText,
				parent: category.id,
				topic: topic,
				permissionOverwrites: [
					{
						id: guild.roles.everyone.id,
						deny: [PermissionFlagsBits.ViewChannel],
					},
				],
			});

			await guildConfig.upsertConfig(
				guild.id,
				key,
				channel.id,
				LOG_CHANNEL_DESCRIPTIONS[key],
			);

			lignes.push(`- ${channel} (crée)`);
		}

		await interaction.editReply({
			content: `Salons de logs prets :\n${lignes.join("\n")}`,
		});
	},
};

export = command;
