import {
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	type Guild,
	type User,
} from "discord.js";
import { LogChannelKey } from "@anubis/shared";
import { unlinkBattlenet } from "@anubis/shared/server";
import * as guildConfig from "../../collectors/guildConfig";
import * as referentiel from "../../collectors/referentiel";
import prisma from "../../prisma";
import type { Command } from "../../types";
import * as colors from "../../utils/constantes";

/**
 * Delier le compte Battle.net d'un membre, en secours du dashboard.
 *
 * Reservee aux administrateurs, comme le bouton de la fiche membre
 * (`battlenet:write`). La permission Discord se declare **et** se revérifie :
 * un administrateur du serveur peut ouvrir la commande a d'autres roles depuis
 * Parametres > Integrations, et ce reglage ne doit pas suffire a la
 * deleguer.
 *
 * `liberer` supprime aussi la trace : le compte Blizzard redevient libre pour
 * n'importe quel compte Discord. Pour un cas legitime seulement — quelqu'un qui
 * s'est verifie avec le compte d'un proche. Une deliaison simple est annoncee
 * par `battlenetNotice` (journal et message prive) ; une liberation ne laisse
 * aucune ligne a ramasser, la commande la journalise donc elle-meme.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("delier_battlenet_admin")
		.setDescription("ADMIN - Délie le compte Battle.net d'un membre.")
		.addUserOption((option) =>
			option.setName("membre").setDescription("Membre à délier.").setRequired(true),
		)
		.addBooleanOption((option) =>
			option
				.setName("liberer")
				.setDescription(
					"Supprime aussi la trace : le compte Blizzard pourra resservir à un autre membre.",
				),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
			await interaction.reply({
				content: "Cette commande est réservée aux administrateurs.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const cible = interaction.options.getUser("membre", true);
		const liberer = interaction.options.getBoolean("liberer") ?? false;

		// `unlinked_by_discord_id` porte une cle etrangere vers `discord_users`.
		await referentiel.upsertUser(interaction.user);

		const resultat = await unlinkBattlenet(prisma, {
			guildId: interaction.guildId,
			userId: cible.id,
			author: { discordUserId: interaction.user.id },
			release: liberer,
		});

		if (resultat === "aucun-lien") {
			await interaction.editReply({
				content: liberer
					? `${cible} n'a aucun compte Battle.net lié ni délié.`
					: `${cible} n'a aucun compte Battle.net lié. Pour libérer un compte qu'il a déjà délié, relance avec \`liberer\`.`,
			});
			return;
		}

		if (resultat === "libere") {
			await journaliserLiberation(interaction.guild, cible, interaction.user).catch((err) =>
				console.error("[Battle.net] Journal de libération non envoyé :", err),
			);
		}

		await interaction.editReply({
			content:
				resultat === "libere"
					? `Compte Battle.net de ${cible} délié et libéré : il pourra être lié à n'importe quel compte Discord.`
					: `Compte Battle.net de ${cible} délié. Une trace empêche de le lier à un autre compte Discord.`,
		});
	},
};

async function journaliserLiberation(guild: Guild, cible: User, auteur: User): Promise<void> {
	const channelId = await guildConfig.getConfig(guild.id, LogChannelKey.MODERATION);
	if (!channelId) return;

	const channel = await guild.channels.fetch(channelId).catch(() => null);
	if (!channel?.isTextBased()) return;

	await channel.send({
		embeds: [
			new EmbedBuilder()
				.setColor(colors.warning)
				.setTitle("🔓 Compte Battle.net libéré")
				.setDescription(
					`<@${cible.id}> | \`${cible.username}\` | \`${cible.id}\`\n` +
						`Délié et libéré par <@${auteur.id}> : le compte Blizzard peut de nouveau être lié à un autre membre.`,
				)
				.setTimestamp(),
		],
	});
}

export = command;
