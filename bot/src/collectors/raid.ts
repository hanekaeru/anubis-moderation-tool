import {
	ChannelType,
	EmbedBuilder,
	GuildVerificationLevel,
	PermissionFlagsBits,
	type Client,
	type Guild,
	type GuildMember,
} from "discord.js";
import { LogChannelKey } from "@anubis/shared";
import * as colors from "../../utils/constantes";
import prisma from "../prisma";
import * as guildConfig from "./guildConfig";

/**
 * Anti-raid : detection d'une vague d'arrivees anormale et confinement
 * (verrouillage des salons ouverts + niveau de verification releve + alerte
 * staff). Le declenchement automatique applique l'effet Discord immediatement
 * (le bot a deja acces au serveur au moment de la detection) ; une demande
 * venue de la webapp (`POST /raid/lockdown`, ou resolution) laisse
 * `discordSyncedAt` a `null` et attend le prochain passage de
 * `applyPendingLockdowns`/`applyPendingResolutions` — meme patron que
 * `Sanction.discordSyncedAt`.
 */

/** guildId -> arrivees recentes (id + horodatage), pour le calcul de la fenetre glissante. */
const joinBuffer = new Map<string, { id: string; ts: number }[]>();

async function hasActiveLockdown(guildId: string): Promise<boolean> {
	const active = await prisma.raidIncident.findFirst({
		where: { guildId, resolvedAt: null },
		select: { id: true },
	});
	return active !== null;
}

async function alertStaff(
	guild: Guild,
	joinCount: number,
	windowSeconds: number,
	alertRoleId: string | null,
): Promise<void> {
	const channelId = await guildConfig.getConfig(guild.id, LogChannelKey.MODERATION);
	if (!channelId) return;

	const channel = await guild.channels.fetch(channelId).catch(() => null);
	if (!channel?.isTextBased()) return;

	const embed = new EmbedBuilder()
		.setColor(colors.danger)
		.setTitle("🚨 Confinement anti-raid declenche")
		.setDescription(
			`${joinCount} arrivees en ${windowSeconds}s. Salons verrouilles, verification renforcee, en attente d'action du staff.`,
		)
		.setTimestamp();

	await channel
		.send({ content: alertRoleId ? `<@&${alertRoleId}>` : undefined, embeds: [embed] })
		.catch(() => undefined);
}

/** Verrouille les salons ouverts et renvoie ceux effectivement verrouilles par cet appel. */
async function lockChannels(guild: Guild): Promise<string[]> {
	const locked: string[] = [];
	const channels = await guild.channels.fetch();

	for (const channel of channels.values()) {
		if (!channel) continue;

		const everyoneId = guild.roles.everyone.id;
		const current = channel.permissionOverwrites.cache.get(everyoneId);

		if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
			if (current?.deny.has(PermissionFlagsBits.SendMessages)) continue;
			await channel.permissionOverwrites
				.edit(everyoneId, { SendMessages: false })
				.catch(() => undefined);
			locked.push(channel.id);
		} else if (channel.type === ChannelType.GuildVoice) {
			if (current?.deny.has(PermissionFlagsBits.Connect)) continue;
			await channel.permissionOverwrites.edit(everyoneId, { Connect: false }).catch(() => undefined);
			locked.push(channel.id);
		}
	}

	return locked;
}

/** Retire uniquement le verrou pose par cette fonction (`Connect`/`SendMessages` a `null`, pas `true`). */
async function unlockChannels(guild: Guild, channelIds: string[]): Promise<void> {
	for (const channelId of channelIds) {
		const channel = await guild.channels.fetch(channelId).catch(() => null);
		if (!channel) continue;

		if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
			await channel.permissionOverwrites
				.edit(guild.roles.everyone.id, { SendMessages: null })
				.catch(() => undefined);
		} else if (channel.type === ChannelType.GuildVoice) {
			await channel.permissionOverwrites
				.edit(guild.roles.everyone.id, { Connect: null })
				.catch(() => undefined);
		}
	}
}

/** A appeler sur chaque arrivee : detecte une vague et declenche le confinement si besoin. */
export async function recordJoin(member: GuildMember): Promise<void> {
	const guild = member.guild;
	const config = await prisma.raidConfig.findUnique({ where: { guildId: guild.id } });
	if (!config?.enabled) return;

	if (await hasActiveLockdown(guild.id)) return;

	const now = Date.now();
	const windowMs = config.windowSeconds * 1000;
	const arrivals = (joinBuffer.get(guild.id) ?? []).filter((entry) => now - entry.ts < windowMs);
	arrivals.push({ id: member.id, ts: now });
	joinBuffer.set(guild.id, arrivals);

	if (arrivals.length < config.joinThreshold) return;

	joinBuffer.delete(guild.id);

	const previousVerificationLevel = guild.verificationLevel;
	const lockedChannelIds = await lockChannels(guild);
	await guild
		.setVerificationLevel(GuildVerificationLevel.High, "Confinement anti-raid automatique.")
		.catch(() => undefined);

	await prisma.raidIncident.create({
		data: {
			guildId: guild.id,
			joinCount: arrivals.length,
			windowSeconds: config.windowSeconds,
			memberIds: arrivals.map((entry) => entry.id),
			lockedChannelIds,
			previousVerificationLevel,
			// Deja applique par cet appel : rien a rattraper pour la tache periodique.
			discordSyncedAt: new Date(),
		},
	});

	console.log(`[Raid] Confinement declenche sur ${guild.name} (${arrivals.length} arrivees).`);
	await alertStaff(guild, arrivals.length, config.windowSeconds, config.alertRoleId);
}

/** Confinements demandes depuis la webapp (`POST /raid/lockdown`), pas encore appliques cote Discord. */
export async function applyPendingLockdowns(client: Client): Promise<void> {
	const pending = await prisma.raidIncident.findMany({
		where: { resolvedAt: null, discordSyncedAt: null },
	});

	for (const incident of pending) {
		const guild = client.guilds.cache.get(incident.guildId);
		if (!guild) continue;

		try {
			const previousVerificationLevel = guild.verificationLevel;
			const lockedChannelIds = await lockChannels(guild);
			await guild
				.setVerificationLevel(GuildVerificationLevel.High, "Confinement anti-raid (webapp).")
				.catch(() => undefined);

			await prisma.raidIncident.update({
				where: { id: incident.id },
				data: { lockedChannelIds, previousVerificationLevel, discordSyncedAt: new Date() },
			});

			const config = await prisma.raidConfig.findUnique({ where: { guildId: incident.guildId } });
			await alertStaff(guild, incident.joinCount, incident.windowSeconds, config?.alertRoleId ?? null);
		} catch (err) {
			console.error(`[Raid] Application du confinement ${incident.id} echouee :`, err);
		}
	}
}

/** Resolutions demandees (bouton bot ou webapp), pas encore rejouees cote Discord. */
export async function applyPendingResolutions(client: Client): Promise<void> {
	const pending = await prisma.raidIncident.findMany({
		where: { resolvedAt: { not: null }, discordSyncedAt: null },
	});

	for (const incident of pending) {
		const guild = client.guilds.cache.get(incident.guildId);
		if (!guild) continue;

		try {
			await unlockChannels(guild, incident.lockedChannelIds);

			if (incident.previousVerificationLevel !== null) {
				await guild
					.setVerificationLevel(
						incident.previousVerificationLevel as GuildVerificationLevel,
						"Fin du confinement anti-raid.",
					)
					.catch(() => undefined);
			}

			await prisma.raidIncident.update({
				where: { id: incident.id },
				data: { discordSyncedAt: new Date() },
			});

			console.log(`[Raid] Confinement ${incident.id} leve sur ${guild.name}.`);
		} catch (err) {
			console.error(`[Raid] Levee du confinement ${incident.id} echouee :`, err);
		}
	}
}
