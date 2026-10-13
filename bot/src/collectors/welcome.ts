import {
	escapeMarkdown,
	type Guild,
	type GuildMember,
	type GuildTextBasedChannel,
	type PartialGuildMember,
} from "discord.js";
import {
	DEFAULT_WELCOME_MESSAGES,
	renderWelcomeMessage,
	WelcomeEvent,
} from "@anubis/shared";
import type { WelcomeConfig } from "@anubis/shared/prisma";
import prisma from "../prisma";
import { roleDAlerte } from "../utils/mentions";

/**
 * Messages automatiques d'arrivee, de depart et de boost (`welcome_config`).
 *
 * Meme fonctionnement que l'annonce des montees de niveau : reglage relu a
 * chaque evenement avec un cache court, rendu par la fonction partagee avec
 * l'apercu du dashboard, echecs avales — un salon supprime ne doit pas
 * interrompre l'enregistrement de l'arrivee elle-meme.
 *
 * Trois choix a garder :
 * - **les comptes de bot n'ont aucun message** : souhaiter la bienvenue a une
 *   integration n'a de sens pour personne ;
 * - **pas de bienvenue pendant un confinement anti-raid** : cinquante comptes
 *   arrives en une minute feraient cinquante messages, et ce sont justement
 *   ceux qu'on ne veut pas accueillir. Les departs et les boosts continuent ;
 * - **l'annonce de boost interpelle la moderation** par `{moderation}`, le role
 *   choisi dans « Rôles & mentions ». Le role de boost, gere par Discord,
 *   n'ouvre volontairement rien : c'est un role bonus pose a la main qui donne
 *   acces aux salons reserves, et l'equipe doit savoir qu'elle a a le donner.
 */

const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { config: WelcomeConfig | null; expiresAt: number }>();

async function getConfig(guildId: string): Promise<WelcomeConfig | null> {
	const connu = cache.get(guildId);
	if (connu && connu.expiresAt > Date.now()) return connu.config;

	const config = await prisma.welcomeConfig.findUnique({ where: { guildId } });
	cache.set(guildId, { config, expiresAt: Date.now() + CACHE_TTL_MS });
	return config;
}

async function salon(guild: Guild, channelId: string | null): Promise<GuildTextBasedChannel | null> {
	if (!channelId) return null;
	const trouve = await guild.channels.fetch(channelId).catch(() => null);
	return trouve?.isTextBased() ? trouve : null;
}

async function envoyer(
	guild: Guild,
	channelId: string | null,
	content: string,
	allowedMentions: { users?: string[]; roles?: string[] },
): Promise<void> {
	const cible = await salon(guild, channelId);

	// Le reglage etait valide a l'enregistrement (l'API exige un salon) : un
	// salon devenu introuvable est une configuration a reprendre, pas une raison
	// d'ecrire ailleurs.
	if (!cible) {
		console.error(`[Accueil] Salon ${channelId} introuvable sur ${guild.name}.`);
		return;
	}

	await cible.send({ content, allowedMentions }).catch((err) => {
		console.error(`[Accueil] Message non envoyé dans ${channelId} :`, err);
	});
}

function nomAffiche(member: GuildMember | PartialGuildMember): string {
	const nom =
		member.nickname ?? member.user?.globalName ?? member.user?.username ?? member.id;
	return escapeMarkdown(nom);
}

async function confinementEnCours(guildId: string): Promise<boolean> {
	const incident = await prisma.raidIncident.findFirst({
		where: { guildId, resolvedAt: null },
		select: { id: true },
	});
	return incident !== null;
}

export async function annoncerArrivee(member: GuildMember): Promise<void> {
	if (member.user.bot) return;

	const config = await getConfig(member.guild.id);
	if (!config?.joinEnabled) return;
	if (await confinementEnCours(member.guild.id)) return;

	const content = renderWelcomeMessage(
		config.joinMessage ?? DEFAULT_WELCOME_MESSAGES[WelcomeEvent.JOIN],
		{
			userId: member.id,
			displayName: nomAffiche(member),
			guildName: member.guild.name,
			memberCount: member.guild.memberCount,
		},
	);

	await envoyer(member.guild, config.channelId, content, { users: [member.id] });
}

/**
 * Depart volontaire, expulsion ou bannissement : Discord ne les distingue pas
 * a ce stade, et le message n'a pas a le faire — le journal de moderation s'en
 * charge. Personne n'est mentionne : le membre n'est plus la pour le lire.
 */
export async function annoncerDepart(member: GuildMember | PartialGuildMember): Promise<void> {
	if (member.user?.bot) return;

	const config = await getConfig(member.guild.id);
	if (!config?.leaveEnabled) return;

	const content = renderWelcomeMessage(
		config.leaveMessage ?? DEFAULT_WELCOME_MESSAGES[WelcomeEvent.LEAVE],
		{
			userId: member.id,
			displayName: nomAffiche(member),
			guildName: member.guild.name,
			memberCount: member.guild.memberCount,
		},
	);

	await envoyer(member.guild, config.channelId, content, { users: [] });
}

/**
 * Premier boost d'un membre.
 *
 * La mention du role vit dans le contenu du message, jamais dans un embed :
 * Discord ne notifie pas une mention posee dans un embed.
 */
export async function annoncerBoost(member: GuildMember): Promise<void> {
	const config = await getConfig(member.guild.id);
	if (!config?.boostEnabled) return;

	const alertRoleId = await roleDAlerte(member.guild.id);

	const content = renderWelcomeMessage(
		config.boostMessage ?? DEFAULT_WELCOME_MESSAGES[WelcomeEvent.BOOST],
		{
			userId: member.id,
			displayName: nomAffiche(member),
			guildName: member.guild.name,
			memberCount: member.guild.memberCount,
			boostCount: member.guild.premiumSubscriptionCount ?? 0,
			alertRoleId,
		},
	);

	await envoyer(member.guild, config.boostChannelId ?? config.channelId, content, {
		users: [member.id],
		roles: alertRoleId ? [alertRoleId] : [],
	});
}
