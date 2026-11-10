import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import { BATTLENET_LINK_RETENTION_DAYS } from "@anubis/shared";
import { unlinkBattlenet } from "@anubis/shared/server";
import * as battlenet from "../../collectors/battlenet";
import prisma from "../../prisma";
import type { Command } from "../../types";

const CONFIRMER = "battlenet:delier:oui";
const ANNULER = "battlenet:delier:non";

/**
 * Delier son propre compte Battle.net.
 *
 * Exigee par les conditions de Blizzard (§11) et par le RGPD : le membre doit
 * pouvoir retirer son lien lui-meme, sans passer par l'equipe. Il **garde son
 * acces** s'il est deja libere de la quarantaine, et perd le role « BattleTag
 * verifie ».
 *
 * La trace qui reste est dite avant la confirmation : sans elle, delier puis
 * relier le meme compte sur un autre compte Discord contournerait l'unicite,
 * et le membre doit savoir que ce compte ne lui est pas rendu libre.
 *
 * Confirmation par boutons sur la reponse ephemere elle-meme : ils ne valent
 * que pour cette personne et cette minute, inutile de les router par
 * `interactionCreate`.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("delier_battlenet")
		.setDescription("Délie ton compte Battle.net de ton compte Discord sur ce serveur."),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const lien = await battlenet.lienActif(interaction.user.id);
		if (!lien) {
			await interaction.reply({
				content: "Aucun compte Battle.net n'est lié à ton compte Discord.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const mois = Math.round(BATTLENET_LINK_RETENTION_DAYS / 30);
		const reponse = await interaction.reply({
			content:
				"Délier ton compte Battle.net ? Tu gardes ton accès au serveur, mais tu perds " +
				"le rôle « BattleTag vérifié » et ton BattleTag est effacé.\n" +
				`-# Une empreinte du compte est conservée ${mois} mois pour qu'il ne puisse pas ` +
				"être lié à un autre compte Discord. Tu pourras le relier toi-même à tout moment.",
			components: [
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(CONFIRMER)
						.setLabel("Délier mon compte")
						.setStyle(ButtonStyle.Danger),
					new ButtonBuilder()
						.setCustomId(ANNULER)
						.setLabel("Annuler")
						.setStyle(ButtonStyle.Secondary),
				),
			],
			flags: MessageFlags.Ephemeral,
			withResponse: true,
		});

		const clic = await reponse.resource?.message
			?.awaitMessageComponent({
				componentType: ComponentType.Button,
				filter: (i) => i.user.id === interaction.user.id,
				time: 60_000,
			})
			.catch(() => null);

		if (!clic || clic.customId === ANNULER) {
			await interaction.editReply({
				content: clic ? "Rien n'a été délié." : "Délai dépassé, rien n'a été délié.",
				components: [],
			});
			if (clic) await clic.deferUpdate().catch(() => undefined);
			return;
		}

		await clic.deferUpdate();
		const resultat = await unlinkBattlenet(prisma, {
			guildId: interaction.guildId,
			userId: interaction.user.id,
			author: { discordUserId: interaction.user.id },
			release: false,
		});

		await interaction.editReply({
			content:
				resultat === "delie"
					? "Ton compte Battle.net est délié. Tu peux le relier quand tu veux avec `/lier_battlenet`."
					: "Aucun compte Battle.net n'est lié à ton compte Discord.",
			components: [],
		});
	},
};

export = command;
