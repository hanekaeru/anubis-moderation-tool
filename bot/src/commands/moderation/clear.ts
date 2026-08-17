import {
	ChannelType,
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	type Guild,
	type Message,
} from "discord.js";
import { LogChannelKey } from "@anubis/shared";
import * as guildConfig from "../../collectors/guildConfig";
import type { Command } from "../../types";
import * as colors from "../../utils/constantes";
import {
	baseCommandEmbed,
	repondreEchec,
	repondreSucces,
} from "../../utils/commandEmbed";

/** Plafond de `bulkDelete` cote Discord : au-dela, l'appel est refuse. */
const MAX_MESSAGES = 100;

/**
 * Discord refuse de supprimer en masse un message de plus de quatorze jours.
 * La borne est verifiee ici pour pouvoir le dire clairement, plutot que de
 * laisser l'API renvoyer une erreur opaque.
 */
const AGE_LIMITE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Nettoyage d'un salon.
 *
 * Avec l'option `membre`, on ne peut pas se contenter de prendre les N derniers
 * messages : il faut en lire davantage pour y trouver N messages de cette
 * personne. On en releve donc jusqu'a 100 (le maximum d'un seul appel) et on
 * filtre — au-dela, la commande se relance.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("clear")
		.setDescription("Supprimer les derniers messages du salon.")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
		.addIntegerOption((option) =>
			option
				.setName("nombre")
				.setDescription("Combien de messages supprimer (1 à 100).")
				.setRequired(true)
				.setMinValue(1)
				.setMaxValue(MAX_MESSAGES),
		)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Ne supprimer que les messages de ce membre.")
				.setRequired(false),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const responseEmbed = baseCommandEmbed("clear");

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
			await repondreEchec(
				interaction,
				responseEmbed,
				"Tu n'as pas la permission de supprimer des messages.",
			);
			return;
		}

		const salon = interaction.channel;
		if (!salon || salon.type !== ChannelType.GuildText) {
			await repondreEchec(
				interaction,
				responseEmbed,
				"Cette commande ne fonctionne que dans un salon textuel.",
			);
			return;
		}

		if (!salon.permissionsFor(interaction.guild.members.me!)?.has(PermissionFlagsBits.ManageMessages)) {
			await repondreEchec(
				interaction,
				responseEmbed,
				"Il me manque la permission « Gérer les messages » dans ce salon.",
			);
			return;
		}

		const nombre = interaction.options.getInteger("nombre", true);
		const cible = interaction.options.getUser("membre");

		// Differe : la lecture puis la suppression depassent volontiers les trois
		// secondes accordees a une interaction.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const recents = await salon.messages.fetch({ limit: MAX_MESSAGES });
		const limite = Date.now() - AGE_LIMITE_MS;

		const candidats: Message<true>[] = [];
		let ignoresTropVieux = 0;

		for (const message of recents.values()) {
			if (cible && message.author.id !== cible.id) continue;
			if (message.createdTimestamp < limite) {
				ignoresTropVieux += 1;
				continue;
			}
			if (candidats.length >= nombre) break;
			candidats.push(message);
		}

		if (!candidats.length) {
			const raison = ignoresTropVieux
				? "Les messages trouvés ont plus de 14 jours : Discord interdit leur suppression en masse."
				: "Aucun message à supprimer ici.";
			await responseEmbed.setDescription(raison).setColor(colors.danger);
			await interaction.editReply({ embeds: [responseEmbed] });
			return;
		}

		let supprimes: number;
		try {
			const effaces = await salon.bulkDelete(candidats, true);
			supprimes = effaces.size;
		} catch (err) {
			console.error("[Modération] Nettoyage du salon échoué :", err);
			responseEmbed
				.setDescription("La suppression a échoué côté Discord.")
				.setColor(colors.danger);
			await interaction.editReply({ embeds: [responseEmbed] });
			return;
		}

		await journaliser(interaction.guild, {
			auteur: interaction.user.id,
			salon: salon.id,
			supprimes,
			cible: cible?.id ?? null,
		});

		const surQui = cible ? ` de ${cible}` : "";
		const reste = ignoresTropVieux
			? `\n${ignoresTropVieux} message(s) de plus de 14 jours ont été laissés : Discord interdit leur suppression en masse.`
			: "";

		responseEmbed
			.setDescription(`${supprimes} message(s)${surQui} supprimé(s).${reste}`)
			.setColor(colors.success);
		await interaction.editReply({ embeds: [responseEmbed] });
	},
};

/**
 * Une suppression de masse ne laisse aucune trace sur Discord : sans cette
 * entree dans le journal de moderation, personne ne saurait qui a efface quoi.
 */
async function journaliser(
	guild: Guild,
	details: { auteur: string; salon: string; supprimes: number; cible: string | null },
): Promise<void> {
	const channelId = await guildConfig.getConfig(guild.id, LogChannelKey.MODERATION);
	if (!channelId) return;

	const journal = await guild.channels.fetch(channelId).catch(() => null);
	if (!journal?.isTextBased()) return;

	const embed = new EmbedBuilder()
		.setColor(colors.warning)
		.setTitle("Anubis - Nettoyage de salon")
		.setDescription(
			`<@${details.auteur}> a supprimé ${details.supprimes} message(s) dans <#${details.salon}>.`,
		)
		.setTimestamp();

	if (details.cible) {
		embed.addFields({ name: "Membre visé", value: `<@${details.cible}>`, inline: true });
	}

	await journal.send({ embeds: [embed] }).catch(() => undefined);
}

export = command;
