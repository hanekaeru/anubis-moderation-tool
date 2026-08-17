import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types";
import prisma from "../../prisma";
import * as referentiel from "../../collectors/referentiel";
import { baseCommandEmbed } from "../../utils/commandEmbed";
import * as colors from "../../utils/constantes";

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("lier-compte")
		.setDescription("Rattacher ce compte Discord à ton compte du dashboard Anubis.")
		.addStringOption((option) =>
			option
				.setName("code")
				.setDescription("Le code affiché sur la page 'Mon compte' du dashboard.")
				.setMinLength(6)
				.setMaxLength(10)
				.setRequired(true),
		),
	async execute(interaction) {
		const responseEmbed = baseCommandEmbed("lier-compte");
		const code = interaction.options.getString("code", true).trim().toUpperCase();

		const pending = await prisma.accountLinkCode.findUnique({
			where: { code },
			include: { appUser: true },
		});

		if (!pending || pending.expiresAt.getTime() < Date.now()) {
			responseEmbed
				.setDescription("Ce code est invalide ou a expiré. Génère-en un nouveau depuis le dashboard.")
				.setColor(colors.danger);
			await interaction.reply({ embeds: [responseEmbed], flags: MessageFlags.Ephemeral });
			return;
		}

		// Un meme compte Discord ne peut etre rattache qu'a un seul compte dashboard.
		const alreadyLinked = await prisma.appUser.findUnique({
			where: { discordUserId: interaction.user.id },
		});
		if (alreadyLinked && alreadyLinked.id !== pending.appUserId) {
			responseEmbed
				.setDescription("Ce compte Discord est déjà rattaché à un autre compte du dashboard.")
				.setColor(colors.danger);
			await interaction.reply({ embeds: [responseEmbed], flags: MessageFlags.Ephemeral });
			return;
		}

		await referentiel.upsertUser(interaction.user);

		try {
			await prisma.appUser.update({
				where: { id: pending.appUserId },
				data: { discordUserId: interaction.user.id },
			});
		} catch (err) {
			console.error("[Compte] Rattachement Discord échoué :", err);
			responseEmbed
				.setDescription("Ce compte Discord est déjà rattaché à un autre compte du dashboard.")
				.setColor(colors.danger);
			await interaction.reply({ embeds: [responseEmbed], flags: MessageFlags.Ephemeral });
			return;
		}

		// Usage unique : le code ne doit plus pouvoir servir une seconde fois.
		await prisma.accountLinkCode.delete({ where: { appUserId: pending.appUserId } });

		responseEmbed
			.setDescription(
				`Compte Discord rattaché à **${pending.appUser.displayName}** (${pending.appUser.username}).`,
			)
			.setColor(colors.success);
		await interaction.reply({ embeds: [responseEmbed], flags: MessageFlags.Ephemeral });
	},
};

export = command;
