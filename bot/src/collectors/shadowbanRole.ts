import type {
	Guild,
	GuildMember,
	NonThreadGuildBasedChannel,
	Role,
} from "discord.js";
import { SHADOWBAN_ROLE_CONFIG_KEY } from "@anubis/shared";
import prisma from "../prisma";
import * as guildConfig from "./guildConfig";
import * as referentiel from "./referentiel";

/**
 * Shadowban par role plutot que par timeout Discord natif.
 *
 * Un timeout natif (`GuildMember.timeout`) est plafonne a 28 jours par Discord
 * lui-meme : impossible d'en faire une sanction permanente. Le role, lui,
 * n'a pas cette limite — mais un role seul ne "retire" rien, les permissions
 * de plusieurs roles s'additionnent. C'est le refus explicite (deny) pose sur
 * chaque salon qui restreint reellement l'acces, comme un role "Mute"
 * classique.
 *
 * Le shadowban retire en plus **tous les roles que le bot peut retirer**, et
 * les rend a la levee. Sans cela, la restriction n'en est pas une : les
 * permissions de plusieurs roles s'additionnent, et un seul role portant une
 * autorisation explicite (`SendMessages` accorde salon par salon, comme en ont
 * souvent les roles de confiance) annule les refus poses sur celui de
 * shadowban.
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
			`[Shadowban] Restriction du salon #${channel.name} échouée :`,
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
		reason: "Rôle de shadowban créé automatiquement.",
	});

	await guildConfig.upsertConfig(
		guild.id,
		SHADOWBAN_ROLE_CONFIG_KEY,
		role.id,
		"Rôle attribué aux membres shadowban : restreint l'accès sans exclusion Discord native.",
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

/**
 * Separe les roles du membre entre ce que le bot peut lui retirer et le reste.
 *
 * Trois familles echappent au retrait, et pour la meme raison : Discord
 * refuserait la modification. Les roles **geres** par une integration (role de
 * bot, role de boost) ne s'attribuent ni ne se retirent, les roles places
 * **au-dessus** du plus haut role du bot lui sont interdits, et `@everyone`
 * n'est pas un role attribuable. Les inclure dans la sauvegarde ferait echouer
 * l'appel entier — donc le shadowban — pour un role qui ne serait de toute
 * facon jamais rendu.
 */
export function partitionRoles(
	member: GuildMember,
	shadowbanRoleId: string,
): { kept: string[]; removable: string[] } {
	const botHighest = member.guild.members.me?.roles.highest ?? null;

	const kept: string[] = [];
	const removable: string[] = [];

	for (const role of member.roles.cache.values()) {
		// `@everyone` porte l'identifiant du serveur et n'est jamais transmis.
		if (role.id === member.guild.id) continue;
		if (role.id === shadowbanRoleId) continue;

		const manageable =
			!role.managed && botHighest !== null && role.comparePositionTo(botHighest) < 0;

		if (manageable) removable.push(role.id);
		else kept.push(role.id);
	}

	return { kept, removable };
}

/**
 * Applique le shadowban : role pose, autres roles retires et sauvegardes.
 *
 * Un seul appel a `roles.set` plutot qu'un `add` suivi de N `remove` — le
 * membre ne traverse ainsi aucun etat intermediaire ou il aurait perdu ses
 * roles sans porter encore la restriction.
 *
 * La sauvegarde est ecrite **avant** de toucher a Discord : si l'appel echoue a
 * mi-chemin, une ligne decrivant des roles encore portes ne coute rien (la
 * levee les rendra, ils y sont deja), alors que l'inverse — des roles retires
 * sans trace — serait irreparable.
 *
 * Renvoie les roles mis de cote, pour que la commande puisse le dire au
 * moderateur : des roles qui disparaissent sans un mot passeraient pour un bug.
 */
export async function applyShadowban(
	member: GuildMember,
	reason: string,
): Promise<string[]> {
	const role = await ensureShadowbanRole(member.guild);
	const { kept, removable } = partitionRoles(member, role.id);

	if (removable.length) {
		// `shadowban_role_backups` porte une cle etrangere vers `discord_users` :
		// un membre jamais croise par le referentiel ferait echouer l'ecriture.
		await referentiel.upsertUser(member.user);

		await prisma.shadowbanRoleBackup.upsert({
			where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
			update: { roleIds: removable },
			create: {
				guildId: member.guild.id,
				userId: member.id,
				roleIds: removable,
			},
		});
	}

	await member.roles.set([...kept, role.id], reason);
	return removable;
}

/**
 * Leve le shadowban : role retire, roles sauvegardes rendus.
 *
 * Ne fait rien si le serveur n'a jamais eu de shadowban, si le membre ne porte
 * pas le role et si rien n'a ete mis de cote pour lui.
 *
 * La sauvegarde n'est effacee **qu'apres** que Discord a accepte la
 * modification : la supprimer d'abord perdrait les roles pour de bon si
 * l'appel echouait, alors qu'une ligne restee en place sera simplement
 * rejouee au prochain passage.
 *
 * Renvoie les roles reellement rendus — ni ceux disparus entre-temps, ni ceux
 * devenus hors de portee du bot.
 */
export async function liftShadowban(
	member: GuildMember,
	reason: string,
): Promise<string[]> {
	const role = await fetchShadowbanRole(member.guild);

	const backup = await prisma.shadowbanRoleBackup.findUnique({
		where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
	});

	const portait = role !== null && member.roles.cache.has(role.id);
	if (!portait && !backup) return [];

	const target = new Set(
		member.roles.cache
			.filter((porte) => porte.id !== member.guild.id)
			.map((porte) => porte.id),
	);
	if (role) target.delete(role.id);

	// Un role sauvegarde a pu disparaitre, passer au-dessus du bot ou devenir
	// gere depuis la mise a l'ecart. Il est alors ecarte sans faire echouer la
	// restitution des autres : la levee compte plus qu'un role de plus ou de
	// moins.
	const botHighest = member.guild.members.me?.roles.highest ?? null;
	const rendus: string[] = [];

	for (const roleId of backup?.roleIds ?? []) {
		const aRendre = member.guild.roles.cache.get(roleId);
		if (!aRendre || aRendre.managed) continue;
		if (!botHighest || aRendre.comparePositionTo(botHighest) >= 0) continue;

		target.add(roleId);
		rendus.push(roleId);
	}

	await member.roles.set([...target], reason);

	if (backup) {
		await prisma.shadowbanRoleBackup.delete({
			where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
		});
	}

	return rendus;
}
