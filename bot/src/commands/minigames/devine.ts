import {
	type ChatInputCommandInteraction,
	type ColorResolvable,
	EmbedBuilder,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import { MINIGAME_TYPE_EMOJIS, MINIGAME_TYPE_LABELS, MinigameType } from "@anubis/shared";
import * as minigames from "../../collectors/minigames";
import { celebrerMontee } from "../../collectors/xpLevelUp";
import type { Command } from "../../types";
import * as colors from "../../utils/constantes";

/**
 * `/devine` : une seule commande pour les trois jeux a deviner.
 *
 * Elle s'adapte au jeu du jour — autocompletion des heros le jour de « devine
 * le heros », des maps le jour de « devine la map », saisie libre pour le skin
 * (une liste dévoilerait la reponse). Les membres n'ont pas a savoir quelle
 * commande taper, et l'erreur « mauvaise commande le mauvais jour » n'existe
 * pas.
 *
 * Tout est **ephemere** : seule l'annonce de fin, a 23:59, dit la reponse et
 * combien l'ont trouvee.
 */

const essais = (n: number) => `${n} essai${n > 1 ? "s" : ""}`;

function repondre(
	interaction: ChatInputCommandInteraction,
	couleur: ColorResolvable,
	description: string,
	titre?: string,
): Promise<unknown> {
	const embed = new EmbedBuilder().setColor(couleur).setDescription(description);
	if (titre) embed.setTitle(titre);
	return interaction.editReply({ embeds: [embed] });
}

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("devine")
		.setDescription("Propose ta réponse au mini-jeu du jour.")
		.addStringOption((option) =>
			option
				.setName("proposition")
				.setDescription("Ta réponse : un héros, une map ou un skin selon le jeu du jour.")
				.setRequired(true)
				.setMaxLength(100)
				.setAutocomplete(true),
		),
	cooldown: 2,

	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// Le salon de jeu, s'il est regle — fils compris : un fil ouvert dans le
		// salon de jeu en fait partie.
		const config = await minigames.reglage(interaction.guildId);
		const salon = interaction.channel;
		const dansLeSalon =
			!config.playChannelId ||
			salon?.id === config.playChannelId ||
			(salon?.isThread() && salon.parentId === config.playChannelId);
		if (!dansLeSalon) {
			await repondre(interaction, colors.warning, `Les mini-jeux se jouent dans <#${config.playChannelId}>.`);
			return;
		}

		const saisie = interaction.options.getString("proposition", true);
		const issue = await minigames.proposer(interaction.guildId, interaction.user, saisie);

		switch (issue.kind) {
			case "NO_GAME":
				await repondre(interaction, colors.info, "Il n'y a pas de mini-jeu à deviner en ce moment. Reviens demain !");
				return;

			case "NOT_A_GUESS": {
				const ou = issue.channelId ? ` dans <#${issue.channelId}>` : "";
				const comment =
					issue.type === MinigameType.CLIP
						? `Aujourd'hui, c'est **${MINIGAME_TYPE_LABELS[issue.type]}** : rien à deviner, mais tout se passe${ou} !`
						: `Aujourd'hui, c'est **${MINIGAME_TYPE_LABELS[issue.type]}** : réponds au sondage${ou} !`;
				await repondre(interaction, colors.info, `${MINIGAME_TYPE_EMOJIS[issue.type]} ${comment}`);
				return;
			}

			case "UNKNOWN": {
				const quoi = issue.type === MinigameType.GUESS_MAP ? "Aucune map" : "Aucun héros";
				const texte =
					issue.type === MinigameType.GUESS_SKIN
						? "Ta proposition est vide."
						: `${quoi} ne correspond à « ${saisie} ». Choisis dans la liste proposée — ça ne t'a pas coûté d'essai.`;
				await repondre(interaction, colors.warning, texte);
				return;
			}

			case "ALREADY_SOLVED":
				await repondre(interaction, colors.success, "Tu as déjà trouvé le mini-jeu du jour. Reviens demain !");
				return;

			case "OUT_OF_ATTEMPTS":
				await repondre(interaction, colors.danger, issue.message, "Plus d'essais pour aujourd'hui");
				return;

			case "DUPLICATE":
				await repondre(
					interaction,
					colors.warning,
					`Tu as déjà proposé **${issue.label}**. Ça ne t'a pas coûté d'essai — il t'en reste ${issue.attemptsLeft}.`,
				);
				return;

			case "HERO_ALREADY_FOUND":
				await repondre(
					interaction,
					colors.warning,
					`Tu as déjà trouvé le héros : il manque le nom du skin ! Il te reste ${essais(issue.attemptsLeft)}.`,
				);
				return;

			case "CONFLICT":
				await repondre(interaction, colors.warning, "Deux propositions sont arrivées en même temps : réessaie.");
				return;

			case "PLAYED": {
				const gain = issue.xp ? `\nTu gagnes **${issue.xp.amount} XP**.` : "";
				const reste = issue.attemptsLeft > 0 ? `Il te reste ${essais(issue.attemptsLeft)}.` : "";

				if (issue.verdict === "SOLVED") {
					await repondre(
						interaction,
						colors.success,
						`C'était bien **${issue.label}** !${gain}\nLa réponse sera annoncée à tous ce soir à la fin du jeu : garde-la pour toi 🤫`,
						"🎉 Trouvé !",
					);
				} else if (issue.verdict === "HERO") {
					await repondre(
						interaction,
						colors.warning,
						`C'est le bon héros, mais pas le bon skin !${gain}\n${reste || "C'était ton dernier essai."}`,
						"🟨 Presque !",
					);
				} else if (issue.outOfAttemptsMessage) {
					await repondre(
						interaction,
						colors.danger,
						`Ce n'est pas **${issue.label}**.\n\n${issue.outOfAttemptsMessage}`,
						"❌ Raté",
					);
				} else {
					await repondre(interaction, colors.danger, `Ce n'est pas **${issue.label}**. ${reste}`, "❌ Raté");
				}

				// Meme suite qu'une montee de niveau gagnee en ecrivant : roles de
				// palier puis annonce, selon le reglage du serveur.
				if (issue.xp && issue.xp.after.level > issue.xp.before.level && interaction.channel) {
					await celebrerMontee(interaction.member, issue.xp.after.level, interaction.channel);
				}
				return;
			}
		}
	},

	async autocomplete(interaction) {
		if (!interaction.inCachedGuild()) return;
		const saisie = interaction.options.getFocused();
		await interaction.respond(await minigames.suggestions(interaction.guildId, saisie));
	},
};

export = command;
