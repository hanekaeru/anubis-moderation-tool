import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	type Guild,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import { LogChannelKey } from "@anubis/shared";
import * as guildConfig from "../../collectors/guildConfig";
import * as referentiel from "../../collectors/referentiel";
import xpManager from "../../collectors/xp";
import { celebrerMontee } from "../../collectors/xpLevelUp";
import * as xpRewards from "../../collectors/xpRewards";
import prisma from "../../prisma";
import type { Command } from "../../types";
import * as colors from "../../utils/constantes";

/**
 * Ajouter ou retirer de l'experience a la main — d'abord pour recompenser le
 * meilleur clip de la semaine, que le staff designe lui-meme.
 *
 * Reservee aux administrateurs : la permission Discord `Administrator` est
 * **declaree** (la commande n'apparait pas aux autres) et **reverifiee** a
 * l'execution, comme `/delier_battlenet_admin` — un reglage des integrations
 * du serveur peut rouvrir une commande a d'autres roles.
 *
 * Chaque ajustement laisse deux traces : une ligne `xp_adjustments` et une
 * entree dans le journal de moderation. Sans elles, l'XP n'est qu'un total sans
 * memoire, et personne ne saurait d'ou vient un ecart.
 */

const MAX_MONTANT = 100_000;

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("xp-admin")
		.setDescription("Ajoute ou retire de l'expérience à un membre.")
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand((sub) =>
			sub
				.setName("ajouter")
				.setDescription("Ajoute de l'expérience à un membre.")
				.addUserOption((o) => o.setName("membre").setDescription("Membre à récompenser.").setRequired(true))
				.addIntegerOption((o) =>
					o.setName("montant").setDescription("Expérience à ajouter.").setRequired(true).setMinValue(1).setMaxValue(MAX_MONTANT),
				)
				.addStringOption((o) =>
					o.setName("raison").setDescription("Pourquoi (meilleur clip de la semaine…).").setRequired(true).setMaxLength(500),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("retirer")
				.setDescription("Retire de l'expérience à un membre.")
				.addUserOption((o) => o.setName("membre").setDescription("Membre concerné.").setRequired(true))
				.addIntegerOption((o) =>
					o.setName("montant").setDescription("Expérience à retirer.").setRequired(true).setMinValue(1).setMaxValue(MAX_MONTANT),
				)
				.addStringOption((o) => o.setName("raison").setDescription("Pourquoi.").setRequired(true).setMaxLength(500)),
		),

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

		const ajout = interaction.options.getSubcommand() === "ajouter";
		const cible = interaction.options.getUser("membre", true);
		const montant = interaction.options.getInteger("montant", true);
		const raison = interaction.options.getString("raison", true).trim();

		if (cible.bot) {
			await interaction.editReply("Les bots n'ont pas d'expérience.");
			return;
		}

		// Un retrait est borne au total : l'experience ne descend jamais sous zero.
		const actuelle = await xpManager.getXp(cible.id, interaction.guildId);
		const delta = ajout ? montant : -Math.min(montant, actuelle);
		if (delta === 0) {
			await interaction.editReply(`${cible} n'a aucune expérience à retirer.`);
			return;
		}

		await referentiel.upsertUser(cible);
		await prisma.xpAdjustment.create({
			data: { guildId: interaction.guildId, userId: cible.id, delta, reason: raison, authorId: interaction.user.id },
		});
		const { before, after } = await xpManager.addXp(cible.id, interaction.guildId, delta);

		// Les roles de palier suivent le niveau dans les deux sens. La descente
		// n'existe qu'ici : seul un retrait explicite dit qu'un membre ne merite
		// plus son rang.
		const membre = await interaction.guild.members.fetch(cible.id).catch(() => null);
		if (membre && after.level !== before.level) {
			if (after.level > before.level && interaction.channel) {
				await celebrerMontee(membre, after.level, interaction.channel);
			} else if (after.level < before.level) {
				await xpRewards
					.applyForMember(membre, after.level, { demote: true })
					.catch((err) => console.error("[XP] Descente des paliers échouée :", err));
			}
		}

		await journaliser(interaction, { cible: cible.id, delta, raison, avant: before.level, apres: after.level });

		const niveau =
			after.level === before.level ? `Niveau ${after.level}.` : `Niveau ${before.level} → **${after.level}**.`;
		const corrige = !ajout && -delta < montant ? `\n-# Retrait limité à ${-delta} XP : le membre n'en avait pas davantage.` : "";
		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setColor(ajout ? colors.success : colors.warning)
					.setDescription(
						`${ajout ? "+" : "−"}${Math.abs(delta)} XP pour ${cible} (${before.xp} → ${after.xp} XP). ${niveau}${corrige}`,
					),
			],
		});
	},
};

async function journaliser(
	interaction: ChatInputCommandInteraction<"cached">,
	details: { cible: string; delta: number; raison: string; avant: number; apres: number },
): Promise<void> {
	const guild: Guild = interaction.guild;
	const channelId = await guildConfig.getConfig(guild.id, LogChannelKey.MODERATION);
	if (!channelId) return;
	const journal = await guild.channels.fetch(channelId).catch(() => null);
	if (!journal?.isTextBased()) return;

	const ajout = details.delta > 0;
	const embed = new EmbedBuilder()
		.setColor(ajout ? colors.success : colors.warning)
		.setTitle(ajout ? "✨ Expérience ajoutée" : "➖ Expérience retirée")
		.setDescription(
			`<@${interaction.user.id}> a ${ajout ? "ajouté" : "retiré"} **${Math.abs(details.delta)} XP** à <@${details.cible}>.`,
		)
		.addFields(
			{ name: "Raison", value: details.raison.slice(0, 1024) },
			{
				name: "Niveau",
				value: details.avant === details.apres ? String(details.apres) : `${details.avant} → ${details.apres}`,
				inline: true,
			},
		)
		.setTimestamp();

	await journal
		.send({ embeds: [embed], allowedMentions: { parse: [] } })
		.catch((err) => console.error("[XP] Journal de l'ajustement non envoyé :", err));
}

export = command;
