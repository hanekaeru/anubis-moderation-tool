import type {
	Guild,
	GuildMember,
	NonThreadGuildBasedChannel,
	Role,
} from "discord.js";
import { SHADOWBAN_ROLE_CONFIG_KEY } from "@anubis/shared";
import * as guildConfig from "./guildConfig";

/**
 * Shadowban par role plutot que par timeout Discord natif.
 *
 * Un timeout natif (`GuildMember.timeout`) est plafonne a 28 jours par Discord
 * lui-meme : impossible d'en faire une sanction permanente. Le role, lui,
 * n'a pas cette limite — mais un role seul ne "retire" rien, les permissions
 * de plusieurs roles s'additionnent. C'est le refus explicite (deny) pose sur
 * chaque salon qui restreint reellement l'acces, comme un role "Mute"
 * classique.
 */

const ROLE_NAME = "Shadowban";

const DENY_OVERWRITE = {
	SendMessages: false,
	SendMessagesInThreads: false,
	AddReactions: false,
	CreatePublicThreads: false,
	CreatePrivateThreads: false,
	Speak: false,
	Connect: false,
	Stream: false,
} as const;

async function applyChannelOverwrite(
	channel: NonThreadGuildBasedChannel,
	role: Role,
): Promise<void> {
	try {
		await channel.permissionOverwrites.edit(role, DENY_OVERWRITE);
	} catch (err) {
		console.error(
			`[Shadowban] Restriction du salon #${channel.name} echouee :`,
			err,
		);
	}
}

async function fetchShadowbanRole(guild: Guild): Promise<Role | null> {
	const existingId = await guildConfig.getConfig(
		guild.id,
		SHADOWBAN_ROLE_CONFIG_KEY,
	);
	if (!existingId) return null;

	return guild.roles.fetch(existingId).catch(() => null);
}

/**
 * Recupere le role de shadowban du serveur, ou le cree au premier usage — avec
 * la restriction posee sur tous les salons existants a cet instant. Les salons
 * crees ensuite sont couverts par l'evenement `channelCreate`.
 */
export async function ensureShadowbanRole(guild: Guild): Promise<Role> {
	const existing = await fetchShadowbanRole(guild);
	if (existing) return existing;

	const role = await guild.roles.create({
		name: ROLE_NAME,
		hoist: false,
		mentionable: false,
		permissions: [],
		reason: "Role de shadowban cree automatiquement.",
	});

	await guildConfig.upsertConfig(
		guild.id,
		SHADOWBAN_ROLE_CONFIG_KEY,
		role.id,
		"Role attribue aux membres shadowban : restreint l'acces sans exclusion Discord native.",
	);

	const channels = await guild.channels.fetch();
	for (const channel of channels.values()) {
		if (channel) await applyChannelOverwrite(channel, role);
	}

	return role;
}

/** A appeler depuis l'evenement `channelCreate` pour couvrir les nouveaux salons. */
export async function syncShadowbanOverwrite(
	channel: NonThreadGuildBasedChannel,
): Promise<void> {
	const role = await fetchShadowbanRole(channel.guild);
	if (role) await applyChannelOverwrite(channel, role);
}

export async function applyShadowban(
	member: GuildMember,
	reason: string,
): Promise<void> {
	const role = await ensureShadowbanRole(member.guild);
	await member.roles.add(role, reason);
}

/** Ne fait rien si le serveur n'a jamais eu de shadowban ou si le membre ne l'a pas. */
export async function liftShadowban(
	member: GuildMember,
	reason: string,
): Promise<void> {
	const role = await fetchShadowbanRole(member.guild);
	if (role && member.roles.cache.has(role.id)) {
		await member.roles.remove(role, reason);
	}
}
