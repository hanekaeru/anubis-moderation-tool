import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	type User,
} from "discord.js";
import * as colors from "./constantes";
import type { LeaderboardRow, XPProgress } from "./xpManager";

/**
 * Presentation du systeme d'XP : barre de progression, fiche de rang,
 * classement.
 *
 * Regroupees ici plutot que dans chaque commande, pour que `/rank` et
 * `/classement` parlent de la meme facon d'une meme donnee.
 */

const BAR_LENGTH = 20;

/**
 * Barre de progression en caracteres pleins.
 *
 * Des blocs plutot qu'un pourcentage seul : la position dans le niveau se lit
 * d'un coup d'oeil, sans avoir a rapporter deux nombres l'un a l'autre. Le
 * chiffre reste affiche a cote, parce qu'une barre ne se lit pas au lecteur
 * d'ecran.
 */
export function progressBar(ratio: number): string {
	const filled = Math.max(0, Math.min(BAR_LENGTH, Math.round(ratio * BAR_LENGTH)));
	return `${"█".repeat(filled)}${"░".repeat(BAR_LENGTH - filled)}`;
}

/** Separateur de milliers, pour que 12500 se lise « 12 500 ». */
export function formatXp(xp: number): string {
	return xp.toLocaleString("fr-FR");
}

/** Medaille pour le podium, numero au-dela : le rang se repere sans lire. */
function rankBadge(rank: number): string {
	return { 1: "🥇", 2: "🥈", 3: "🥉" }[rank] ?? `\`#${rank}\``;
}

export function rankEmbed(
	user: User,
	progress: XPProgress,
	rank: number,
	total: number,
): EmbedBuilder {
	const percent = Math.round(progress.ratio * 100);

	return new EmbedBuilder()
		.setColor(colors.info)
		.setAuthor({
			name: user.globalName ?? user.username,
			iconURL: user.displayAvatarURL({ size: 128 }),
		})
		.setThumbnail(user.displayAvatarURL({ size: 256 }))
		.addFields(
			{ name: "Niveau", value: `**${progress.level}**`, inline: true },
			{
				name: "Rang",
				value: `${rankBadge(rank)} sur ${total}`,
				inline: true,
			},
			{ name: "XP totale", value: `${formatXp(progress.xp)} XP`, inline: true },
			{
				name: `Progression — ${percent} %`,
				value: [
					`\`${progressBar(progress.ratio)}\``,
					`${formatXp(progress.xpIntoLevel)} / ${formatXp(progress.xpForLevel)} XP`,
					`Encore **${formatXp(progress.xpToNextLevel)} XP** avant le niveau ${progress.level + 1}.`,
				].join("\n"),
			},
		)
		.setFooter({ text: "L'XP s'accumule en discutant sur le serveur." })
		.setTimestamp();
}

export function leaderboardEmbed(
	rows: LeaderboardRow[],
	page: number,
	pageCount: number,
	total: number,
	/** Nom d'affichage par identifiant, resolu par la commande. */
	names: Map<string, string>,
): EmbedBuilder {
	const lines = rows.map((row) => {
		const name = names.get(row.userId) ?? `<@${row.userId}>`;
		return `${rankBadge(row.rank)} **${name}** — niveau ${row.level} · ${formatXp(row.xp)} XP`;
	});

	return new EmbedBuilder()
		.setColor(colors.success)
		.setTitle("🏆 Classement du serveur")
		.setDescription(lines.join("\n") || "Personne n'a encore gagné d'XP.")
		.setFooter({ text: `Page ${page} / ${pageCount} — ${total} membre(s) classé(s)` })
		.setTimestamp();
}

/** Prefixe des boutons de pagination, reconnu par `interactionCreate`. */
export const LEADERBOARD_BUTTON_PREFIX = "xp:classement:";

/**
 * Boutons de pagination.
 *
 * La page voulue est portee par le `customId` plutot que par un collecteur en
 * memoire : un classement reste ainsi navigable apres un redemarrage du bot, et
 * n'immobilise aucun etat cote process.
 */
export function leaderboardButtons(
	page: number,
	pageCount: number,
): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`${LEADERBOARD_BUTTON_PREFIX}${page - 1}`)
			.setLabel("Précédent")
			.setEmoji("◀️")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page <= 1),
		new ButtonBuilder()
			.setCustomId(`${LEADERBOARD_BUTTON_PREFIX}${page + 1}`)
			.setLabel("Suivant")
			.setEmoji("▶️")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page >= pageCount),
	);
}
