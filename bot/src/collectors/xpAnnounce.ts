import type { GuildMember, GuildTextBasedChannel } from "discord.js";
import {
	defaultXpLevelUpMessage,
	renderXpLevelUpMessage,
	XpAnnouncementMode,
} from "@anubis/shared";
import type { XpConfig } from "@anubis/shared/prisma";
import prisma from "../prisma";

/**
 * Annonce des montees de niveau.
 *
 * Le reglage vient du dashboard (`xp_config`) et vaut pour tout le serveur. Il
 * ne suit **pas** le patron `discordSyncedAt` : il ne decrit rien a rejouer sur
 * Discord, seulement la facon de rediger la prochaine annonce. Le bot le relit
 * donc a chaque montee de niveau, avec le meme cache court que l'automod et le
 * bareme de points — sans quoi un changement de salon demanderait un
 * redemarrage.
 *
 * Un serveur sans ligne garde le comportement d'origine : annonce dans le
 * salon ou le niveau a ete atteint, texte par defaut, membre mentionne.
 * L'absence de reglage ne doit jamais valoir « pas d'annonce ».
 */

const CACHE_TTL_MS = 30_000;

/** Doit rester identique aux `@default` de `XpConfig` et aux defauts de l'API. */
const DEFAULTS: Omit<XpConfig, "guildId" | "updatedAt"> = {
	mode: XpAnnouncementMode.CURRENT_CHANNEL,
	channelId: null,
	message: null,
	pingMember: true,
};

const cache = new Map<string, { config: XpConfig | null; expiresAt: number }>();

export async function getConfig(guildId: string): Promise<XpConfig | null> {
	const cached = cache.get(guildId);
	if (cached && cached.expiresAt > Date.now()) return cached.config;

	const config = await prisma.xpConfig.findUnique({ where: { guildId } });

	cache.set(guildId, { config, expiresAt: Date.now() + CACHE_TTL_MS });
	return config;
}

/** Vide le cache d'un serveur : utile aux tests et a un rechargement force. */
export function invalidateCache(guildId?: string): void {
	if (guildId) cache.delete(guildId);
	else cache.clear();
}

export interface LevelUpAnnouncement {
	member: GuildMember;
	level: number;
	/** Roles de palier fraichement obtenus, dans l'ordre des paliers. */
	earnedRoleIds: string[];
	/** Salon ou le niveau a ete atteint, seul mode `CURRENT_CHANNEL` s'en sert. */
	origin: GuildTextBasedChannel;
}

/**
 * Texte de l'annonce, tel qu'il sera envoye.
 *
 * Le rendu vit dans `@anubis/shared` : l'apercu du dashboard passe par la meme
 * fonction, et deux implementations finiraient par diverger — l'apercu
 * mentirait alors sur ce que lira le serveur.
 */
export function buildContent(
	config: Pick<XpConfig, "mode" | "message" | "pingMember">,
	announcement: LevelUpAnnouncement,
): string {
	const { member, level, earnedRoleIds } = announcement;

	return renderXpLevelUpMessage(
		config.message ?? defaultXpLevelUpMessage(config.mode),
		{
			member: config.pingMember ? `<@${member.id}>` : member.displayName,
			level,
			guildName: member.guild.name,
			roleMentions: earnedRoleIds.map((roleId) => `<@&${roleId}>`),
		},
	);
}

/**
 * Previent le membre de sa montee de niveau.
 *
 * Les echecs sont avales : un membre aux messages prives fermes ou un salon
 * devenu inaccessible ne doivent pas interrompre le traitement du message, qui
 * a deja compte l'XP et pose les roles de palier.
 */
export async function announceLevelUp(
	announcement: LevelUpAnnouncement,
): Promise<void> {
	// Une ligne existante est complete : ses colonnes portent toutes une
	// valeur. Le repli ne sert qu'au serveur qui n'a jamais ouvert la page.
	const config = (await getConfig(announcement.member.guild.id)) ?? DEFAULTS;

	if (config.mode === XpAnnouncementMode.DISABLED) return;

	const content = buildContent(config, announcement);

	// Les roles ne sont mentionnes que pour etre lisibles, jamais notifies :
	// une montee de niveau ne doit pas sonner chez tous les porteurs du role.
	const allowedMentions = {
		users: config.pingMember ? [announcement.member.id] : [],
	};

	if (config.mode === XpAnnouncementMode.DIRECT_MESSAGE) {
		await announcement.member.send({ content }).catch(() => undefined);
		return;
	}

	const channel =
		config.mode === XpAnnouncementMode.DEDICATED_CHANNEL
			? await resolveChannel(announcement.member, config.channelId)
			: announcement.origin;

	// Salon dedie supprime ou devenu invisible pour le bot. L'API exige un
	// salon a l'enregistrement, donc le reglage etait valide : basculer sur le
	// salon courant deverserait les annonces la ou le staff avait justement
	// demande qu'elles ne soient pas. Une trace en console, et rien d'autre.
	if (!channel) {
		console.error(
			`[XP] Salon d'annonce ${config.channelId} introuvable sur ${announcement.member.guild.id}.`,
		);
		return;
	}

	await channel.send({ content, allowedMentions }).catch(() => undefined);
}

async function resolveChannel(
	member: GuildMember,
	channelId: string | null,
): Promise<GuildTextBasedChannel | null> {
	if (!channelId) return null;

	const channel = await member.guild.channels.fetch(channelId).catch(() => null);
	return channel?.isTextBased() ? channel : null;
}
