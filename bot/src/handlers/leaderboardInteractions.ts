import type { ButtonInteraction, ChatInputCommandInteraction, Guild } from "discord.js";
import xpManager from "../collectors/xp";
import {
	LEADERBOARD_BUTTON_PREFIX,
	leaderboardButtons,
	leaderboardEmbed,
} from "../utils/xpEmbeds";

/** Nombre de membres par page du classement. */
export const LEADERBOARD_PAGE_SIZE = 10;

/**
 * Noms d'affichage des membres classes.
 *
 * Le classement ne connait que des identifiants : `user_levels` est une table
 * du bot, sans jointure vers le referentiel. Les mentions (`<@id>`) suffiraient
 * a l'affichage, mais elles notifient et rendent le classement bruyant — d'ou
 * la resolution des pseudonymes, avec repli sur la mention pour un membre parti
 * du serveur.
 */
async function resolveNames(guild: Guild, userIds: string[]): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	if (!userIds.length) return names;

	const members = await guild.members.fetch({ user: userIds }).catch(() => null);
	if (!members) return names;

	for (const member of members.values()) {
		names.set(member.id, member.displayName);
	}

	return names;
}

/** Construit la page demandee, bornee au nombre de pages reellement disponibles. */
async function buildPage(guild: Guild, requested: number) {
	const total = await xpManager.countRanked(guild.id);
	const pageCount = Math.max(1, Math.ceil(total / LEADERBOARD_PAGE_SIZE));
	const page = Math.min(Math.max(1, requested), pageCount);

	const rows = await xpManager.getLeaderboard(
		guild.id,
		LEADERBOARD_PAGE_SIZE,
		(page - 1) * LEADERBOARD_PAGE_SIZE,
	);

	const names = await resolveNames(
		guild,
		rows.map((row) => row.userId),
	);

	return {
		embeds: [leaderboardEmbed(rows, page, pageCount, total, names)],
		components: [leaderboardButtons(page, pageCount)],
	};
}

export async function renderLeaderboard(
	interaction: ChatInputCommandInteraction<"cached">,
	page: number,
): Promise<void> {
	await interaction.deferReply();
	await interaction.editReply(await buildPage(interaction.guild, page));
}

export async function handleLeaderboardButton(
	interaction: ButtonInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	const page = Number.parseInt(
		interaction.customId.slice(LEADERBOARD_BUTTON_PREFIX.length),
		10,
	);
	if (Number.isNaN(page)) return;

	// `deferUpdate` et non `deferReply` : la pagination remplace le message
	// existant. Une reponse a part laisserait une pile de classements derriere
	// chaque clic — meme raison que pour le select des tickets.
	await interaction.deferUpdate();
	await interaction.editReply(await buildPage(interaction.guild, page));
}
