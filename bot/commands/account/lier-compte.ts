import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../src/types";
import prisma from "../../src/prisma";
import * as referentiel from "../../src/collectors/referentiel";
import { baseCommandEmbed } from "../../src/utils/commandEmbed";
import * as colors from "../../utils/constantes";

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("lier-compte")
		.setDescription("Rattacher ce compte Discord a ton compte du dashboard Anubis.")
		.addStringOption((option) =>
			option
				.setName("code")
				.setDescription("Le code affiche sur la page 'Mon compte' du dashboard.")
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
				.setDescription("Ce code est invalide ou a expire. Genere-en un nouveau depuis le dashboard.")
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
				.setDescription("Ce compte Discord est deja rattache a un autre compte du dashboard.")
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
			console.error("[Compte] Rattachement Discord echoue :", err);
			responseEmbed
				.setDescription("Ce compte Discord est deja rattache a un autre compte du dashboard.")
				.setColor(colors.danger);
			await interaction.reply({ embeds: [responseEmbed], flags: MessageFlags.Ephemeral });
			return;
		}

		// Usage unique : le code ne doit plus pouvoir servir une seconde fois.
		await prisma.accountLinkCode.delete({ where: { appUserId: pending.appUserId } });

		responseEmbed
			.setDescription(
				`Compte Discord rattache a **${pending.appUser.displayName}** (${pending.appUser.username}).`,
			)
			.setColor(colors.success);
		await interaction.reply({ embeds: [responseEmbed], flags: MessageFlags.Ephemeral });
	},
};

export = command;
