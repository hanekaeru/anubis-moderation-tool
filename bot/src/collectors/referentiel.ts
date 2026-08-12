import type {
	DMChannel,
	Guild,
	GuildBasedChannel,
	GuildMember,
	GuildTextBasedChannel,
	Role,
	User,
} from "discord.js";
import { IdentityEventType, MemberStatus, RoleEventType } from "@anubis/shared";
import prisma from "../prisma";

/**
 * Referentiel Discord : serveur, salons, roles, membres.
 *
 * Deux modes complementaires. Une synchronisation complete au demarrage remet
 * l'etat a plat — indispensable, car tout ce qui s'est passe pendant que le bot
 * etait hors ligne n'a genere aucun evenement. Ensuite, les evenements Discord
 * maintiennent cet etat au fil de l'eau.
 */

type ReferentielChannel = DMChannel | GuildBasedChannel;

/**
 * Couples deja ecrits pendant cette execution.
 *
 * Les tables d'activite ont des cles etrangeres vers guilds, discord_users et
 * channels : ecrire une statistique pour un membre inconnu echouerait. Ce cache
 * evite de reverifier a chaque message ce qui a deja ete garanti une fois.
 */
const contexteConnu = new Set<string>();

export async function upsertGuild(guild: Guild): Promise<void> {
	await prisma.guild.upsert({
		where: { id: guild.id },
		update: { name: guild.name, iconUrl: guild.iconURL() },
		create: { id: guild.id, name: guild.name, iconUrl: guild.iconURL() },
	});
}

export async function upsertUser(user: User): Promise<void> {
	const data = {
		username: user.username,
		globalName: user.globalName ?? null,
		discriminator: user.discriminator === "0" ? null : user.discriminator,
		avatarHash: user.avatar ?? null,
		isBot: user.bot,
		accountCreatedAt: user.createdAt,
	};

	await prisma.discordUser.upsert({
		where: { id: user.id },
		update: data,
		create: { id: user.id, ...data },
	});
}

export async function upsertRole(role: Role): Promise<void> {
	const data = {
		name: role.name,
		color: role.color,
		position: role.position,
		managed: role.managed,
		// Un role recree porte le meme identifiant : on annule une eventuelle
		// suppression precedente.
		deletedAt: null,
	};

	// `trackHistory` est volontairement absent : c'est un reglage du dashboard,
	// pas une donnee Discord. L'ajouter ici le remettrait a sa valeur par
	// defaut a chaque renommage de role et a chaque synchronisation complete.
	await prisma.role.upsert({
		where: { id: role.id },
		update: data,
		create: { id: role.id, guildId: role.guild.id, ...data },
	});
}

export async function marquerRoleSupprime(roleId: string): Promise<void> {
	// Suppression logique : les evenements d'historique referencent ce role et
	// le supprimer pour de bon effacerait la chronologie des membres.
	await prisma.role.updateMany({
		where: { id: roleId, deletedAt: null },
		data: { deletedAt: new Date() },
	});
}

export async function upsertChannel(
	channel: ReferentielChannel,
): Promise<void> {
	if (channel.isDMBased()) return;

	const data = {
		name: channel.name ?? "(sans nom)",
		type: channel.type,
		parentId: "parentId" in channel ? (channel.parentId ?? null) : null,
		position: "rawPosition" in channel ? channel.rawPosition : 0,
		deletedAt: null,
	};

	await prisma.channel.upsert({
		where: { id: channel.id },
		update: data,
		create: { id: channel.id, guildId: channel.guild.id, ...data },
	});
}

export async function marquerSalonSupprime(channelId: string): Promise<void> {
	await prisma.channel.updateMany({
		where: { id: channelId, deletedAt: null },
		data: { deletedAt: new Date() },
	});
}

/**
 * Enregistre un membre et ses roles.
 *
 * `joinCount` n'est incremente que par l'evenement d'arrivee : une
 * synchronisation ne doit pas faire croire a de nouvelles arrivees.
 */
export async function upsertMember(member: GuildMember): Promise<void> {
	await upsertUser(member.user);

	await prisma.member.upsert({
		where: {
			guildId_userId: { guildId: member.guild.id, userId: member.id },
		},
		update: {
			nickname: member.nickname ?? null,
			status: MemberStatus.ACTIVE,
			joinedAt: member.joinedAt,
			leftAt: null,
			boostingSince: member.premiumSince ?? null,
		},
		create: {
			guildId: member.guild.id,
			userId: member.id,
			nickname: member.nickname ?? null,
			status: MemberStatus.ACTIVE,
			joinedAt: member.joinedAt,
			boostingSince: member.premiumSince ?? null,
		},
	});

	await synchroniserRoles(member);
}

/**
 * Aligne member_roles sur l'etat reel du membre.
 *
 * Le role @everyone est ignore : tout le monde le porte, l'enregistrer
 * doublerait la table sans rien apprendre.
 */
export async function synchroniserRoles(
	member: GuildMember,
): Promise<{ ajoutes: string[]; retires: string[] }> {
	const guildId = member.guild.id;
	const rolesActuels = member.roles.cache
		.filter((role) => role.id !== guildId)
		.map((role) => role.id);

	const rolesEnBase = await prisma.memberRole.findMany({
		where: { guildId, userId: member.id },
		select: { roleId: true },
	});

	const enBase = new Set(rolesEnBase.map((r) => r.roleId));
	const ajoutes = rolesActuels.filter((id) => !enBase.has(id));
	const retires = [...enBase].filter((id) => !rolesActuels.includes(id));

	if (ajoutes.length) {
		await prisma.memberRole.createMany({
			data: ajoutes.map((roleId) => ({
				guildId,
				userId: member.id,
				roleId,
			})),
			skipDuplicates: true,
		});
	}

	if (retires.length) {
		await prisma.memberRole.deleteMany({
			where: { guildId, userId: member.id, roleId: { in: retires } },
		});
	}

	return { ajoutes, retires };
}

/**
 * Historise un ajout ou un retrait de role.
 *
 * Les roles marques `trackHistory = false` sont ignores : ce sont les roles
 * decoratifs (couleurs, badges, roles auto-attribues) dont les mouvements
 * noieraient la chronologie du membre sans rien apprendre a la moderation.
 * Le filtre agit ici, a la source, pour ne pas stocker ce bruit ; l'API
 * l'applique aussi a la lecture, de sorte que decocher un role masque
 * egalement ce qui a deja ete enregistre.
 *
 * `member_roles`, qui porte l'etat courant, n'est pas concerne : un role
 * decoratif doit continuer d'apparaitre sur la fiche et de servir de filtre.
 */
export async function enregistrerEvenementsRoles(
	guildId: string,
	userId: string,
	ajoutes: string[],
	retires: string[],
	actorId: string | null = null,
): Promise<void> {
	const concernes = [...new Set([...ajoutes, ...retires])];
	if (!concernes.length) return;

	const nonSuivis = await prisma.role.findMany({
		where: { id: { in: concernes }, trackHistory: false },
		select: { id: true },
	});

	// Un role absent de la base est historise par defaut : mieux vaut un
	// evenement en trop qu'un trou silencieux dans la chronologie.
	const ignores = new Set(nonSuivis.map((role) => role.id));

	const evenements = [
		...ajoutes
			.filter((roleId) => !ignores.has(roleId))
			.map((roleId) => ({
				guildId,
				userId,
				roleId,
				type: RoleEventType.ADDED,
				actorId,
			})),
		...retires
			.filter((roleId) => !ignores.has(roleId))
			.map((roleId) => ({
				guildId,
				userId,
				roleId,
				type: RoleEventType.REMOVED,
				actorId,
			})),
	];

	if (evenements.length) {
		await prisma.memberRoleEvent.createMany({ data: evenements });
	}
}

export async function enregistrerEvenementIdentite(
	guildId: string | null,
	userId: string,
	type: IdentityEventType,
	oldValue: string | null,
	newValue: string | null,
): Promise<void> {
	if (oldValue === newValue) return;

	await prisma.identityEvent.create({
		data: { guildId, userId, type, oldValue, newValue },
	});
}

/**
 * Garantit que le serveur, le membre et le salon existent en base.
 *
 * Appele avant toute ecriture d'activite, pour ne pas violer les cles
 * etrangeres quand un membre parle sans avoir ete vu par la synchronisation.
 */
export async function garantirContexte(
	guild: Guild,
	user: User,
	channel?: GuildTextBasedChannel | null,
): Promise<boolean> {
	const cle = `${guild.id}:${user.id}:${channel?.id ?? "-"}`;
	if (contexteConnu.has(cle)) return true;

	try {
		await upsertGuild(guild);
		await upsertUser(user);

		await prisma.member.upsert({
			where: { guildId_userId: { guildId: guild.id, userId: user.id } },
			update: {},
			create: {
				guildId: guild.id,
				userId: user.id,
				status: MemberStatus.ACTIVE,
			},
		});

		if (channel) await upsertChannel(channel);

		contexteConnu.add(cle);
		return true;
	} catch (err) {
		console.error("[Referentiel] Contexte non garanti :", err);
		return false;
	}
}

/**
 * Synchronisation complete au demarrage.
 *
 * Necessite l'intent privilegie Server Members pour recuperer la liste des
 * membres. Sans lui, `members.fetch()` echoue : le reste est tout de meme
 * synchronise et l'incident est signale une fois, sans arreter le bot.
 */
export async function synchroniserServeur(guild: Guild): Promise<void> {
	const debut = Date.now();
	console.log(`[Referentiel] Synchronisation de ${guild.name}...`);

	await upsertGuild(guild);

	const roles = await guild.roles.fetch();
	for (const role of roles.values()) {
		if (role.id === guild.id) continue;
		await upsertRole(role);
	}

	const salons = await guild.channels.fetch();
	for (const salon of salons.values()) {
		if (salon) await upsertChannel(salon);
	}

	let membresSynchronises = 0;
	let membres: Awaited<ReturnType<Guild["members"]["fetch"]>> | null = null;
	try {
		membres = await guild.members.fetch();
		for (const membre of membres.values()) {
			await upsertMember(membre);
			membresSynchronises++;
		}
	} catch (err) {
		console.error(
			"[Referentiel] Membres non recuperes. Activez l'intent privilegie " +
				'"Server Members" dans le portail developpeur Discord, puis ajoutez ' +
				"GatewayIntentBits.GuildMembers aux intents du client.",
			err instanceof Error ? err.message : err,
		);
	}

	// Les membres partis entre deux demarrages ne generent aucun evenement :
	// on les deduit de leur absence de la liste recuperee. Reutilise la liste
	// deja recuperee ci-dessus : un second guild.members.fetch() doublerait la
	// requete gateway (opcode 8) et rapproche du rate limit sur les redemarrages
	// frequents en dev (nodemon).
	if (membresSynchronises > 0 && membres) {
		const presents = [...membres.keys()];
		const { count } = await prisma.member.updateMany({
			where: {
				guildId: guild.id,
				status: MemberStatus.ACTIVE,
				userId: { notIn: presents },
			},
			data: { status: MemberStatus.LEFT, leftAt: new Date() },
		});
		if (count > 0) {
			console.log(`[Referentiel] ${count} depart(s) rattrape(s).`);
		}
	}

	console.log(
		`[Referentiel] ${guild.name} : ${roles.size} role(s), ${salons.size} salon(s), ` +
			`${membresSynchronises} membre(s) en ${Date.now() - debut} ms.`,
	);
}
