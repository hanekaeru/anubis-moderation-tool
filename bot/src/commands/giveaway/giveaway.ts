import {
	ChannelType,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import {
	DEFAULT_GIVEAWAY_EMOJI,
	GiveawayStatus,
	MAX_GIVEAWAY_DURATION_MINUTES,
	MAX_GIVEAWAY_WINNERS,
	MIN_GIVEAWAY_DURATION_MINUTES,
	isValidGiveawayEmoji,
} from "@anubis/shared";
import type { Command } from "../../types";
import prisma from "../../prisma";
import * as giveaway from "../../collectors/giveaway";
import * as referentiel from "../../collectors/referentiel";

/**
 * Ouvre un concours depuis Discord.
 *
 * La commande ecrit la meme ligne que le dashboard puis publie l'embed
 * elle-meme : l'effet Discord etant deja applique, `discordSyncedAt` est pose
 * dans la foulee et la tache periodique n'a rien a rattraper.
 *
 * La reponse est **deferee** : la creation en base, l'envoi du message et la
 * pose de la reaction ne tiennent pas dans les trois secondes de l'interaction.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("giveaway")
		.setDescription("Lance un concours avec participation par réaction.")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
		.addStringOption((option) =>
			option
				.setName("titre")
				.setDescription("Titre affiché en haut de l'embed.")
				.setRequired(true)
				.setMinLength(3)
				.setMaxLength(160),
		)
		.addStringOption((option) =>
			option
				.setName("lot")
				.setDescription("Ce que le gagnant remporte.")
				.setRequired(true)
				.setMaxLength(200),
		)
		.addIntegerOption((option) =>
			option
				.setName("duree")
				.setDescription("Durée du concours, en minutes.")
				.setRequired(true)
				.setMinValue(MIN_GIVEAWAY_DURATION_MINUTES)
				.setMaxValue(MAX_GIVEAWAY_DURATION_MINUTES),
		)
		.addStringOption((option) =>
			option
				.setName("description")
				.setDescription("Texte libre affiché sous le titre.")
				.setMaxLength(2000),
		)
		.addIntegerOption((option) =>
			option
				.setName("gagnants")
				.setDescription("Nombre de gagnants tirés au sort (1 par défaut).")
				.setMinValue(1)
				.setMaxValue(MAX_GIVEAWAY_WINNERS),
		)
		.addStringOption((option) =>
			option
				.setName("emoji")
				.setDescription(`Réaction de participation (${DEFAULT_GIVEAWAY_EMOJI} par défaut).`),
		)
		.addStringOption((option) =>
			option.setName("image").setDescription("URL de l'image affichée dans l'embed."),
		)
		.addChannelOption((option) =>
			option
				.setName("salon")
				.setDescription("Salon de publication (le salon courant par défaut).")
				.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
		)
		.addChannelOption((option) =>
			option
				.setName("salon_annonce")
				.setDescription("Salon où annoncer le gagnant (celui du concours par défaut).")
				.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
		),

	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const emoji = interaction.options.getString("emoji") ?? DEFAULT_GIVEAWAY_EMOJI;
		if (!isValidGiveawayEmoji(emoji)) {
			await interaction.reply({
				content: "Cet emoji n'est pas utilisable comme réaction de participation.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const image = interaction.options.getString("image");
		if (image && !/^https?:\/\/\S+$/i.test(image)) {
			await interaction.reply({
				content: "L'image doit être une URL commençant par http:// ou https://.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const channel = interaction.options.getChannel("salon") ?? interaction.channel;
		if (!channel || !("send" in channel)) {
			await interaction.reply({
				content: "Ce salon ne peut pas recevoir de message.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const durationMinutes = interaction.options.getInteger("duree", true);
		const announceChannel = interaction.options.getChannel("salon_annonce");

		try {
			// `created_by_discord_id` ne porte pas de cle etrangere, mais le compte
			// est enregistre pour que le dashboard sache nommer l'auteur.
			await referentiel.upsertUser(interaction.user);

			const created = await prisma.giveaway.create({
				data: {
					guildId: interaction.guildId,
					channelId: channel.id,
					title: interaction.options.getString("titre", true),
					description: interaction.options.getString("description"),
					prize: interaction.options.getString("lot", true),
					imageUrl: image,
					reactionEmoji: emoji,
					winnerCount: interaction.options.getInteger("gagnants") ?? 1,
					announceChannelId: announceChannel?.id ?? null,
					endsAt: new Date(Date.now() + durationMinutes * 60_000),
					createdByDiscordId: interaction.user.id,
					status: GiveawayStatus.SCHEDULED,
				},
			});

			const published = await giveaway.publishOne(interaction.client, created);

			await interaction.editReply(
				published
					? `Concours lancé dans <#${channel.id}>. Il se clôturera automatiquement.`
					: "Le concours n'a pas pu être publié : vérifie mes permissions sur le salon.",
			);
		} catch (err) {
			console.error("[Giveaway] Création depuis la commande échouée :", err);
			await interaction.editReply("La création du concours a échoué.");
		}
	},
};

export = command;
