import type { Client, Guild, GuildMember, Role } from "discord.js";
import { QuarantineStage, quarantineStage } from "@anubis/shared";
import prisma from "../prisma";

/**
 * Quarantaine a l'arrivee, en une ou deux etapes.
 *
 * Un role de quarantaine est attribue a chaque nouveau membre. Il en sort quand
 * **toutes** les etapes exigees sont franchies : l'acceptation du reglement
 * (bouton pose par `/quarantaine-message`) et, si `battlenetRequired` est a
 * `true`, la verification d'un compte Battle.net. Aucune expulsion automatique :
 * la quarantaine dure jusque-la, ou jusqu'a une levee manuelle depuis la webapp.
 *
 * Chaque etape porte son propre jeu de roles, ce qui rend l'etat intermediaire
 * visible dans la liste des membres — sans quoi personne ne distinguerait « a
 * accepte, attend de se verifier » de « vient d'arriver ».
 *
 * Meme patron `discordSyncedAt` que l'anti-raid : ce que le bot applique
 * lui-meme (le clic sur un bouton) est marque synchronise dans la foulee, ce qui
 * vient de l'API (verification Battle.net, levee depuis la webapp) reste a
 * `null` jusqu'au prochain passage de `synchroniserQuarantaines`.
 */

export type ResultatAcceptation = "acceptee" | "deja-acceptee" | "hors-service";

/** Ce dont l'application des roles a besoin, et rien de plus. */
type ReglageEtapes = {
	roleId: string | null;
	battlenetRequired: boolean;
	releaseAddRoleIds: string[];
	releaseRemoveRoleIds: string[];
	acceptAddRoleIds: string[];
	acceptRemoveRoleIds: string[];
	verifyAddRoleIds: string[];
	verifyRemoveRoleIds: string[];
};

/** Roles a poser et a retirer en un seul `roles.set`. */
export type LotDeRoles = {
	addRoleIds: string[];
	removeRoleIds: string[];
};

async function configActive(guildId: string) {
	const config = await prisma.quarantineConfig.findUnique({
		where: { guildId },
	});
	if (!config?.enabled || !config.roleId) return null;
	return config;
}

/** Attribue le role de quarantaine a un membre qui vient d'arriver. */
export async function quarantineNewMember(member: GuildMember): Promise<void> {
	const config = await configActive(member.guild.id);
	if (!config?.roleId) return;

	await member.roles.add(config.roleId, "Quarantaine à l'arrivée.");

	// Un membre deja connu qui revient repart en quarantaine : ses roles Discord
	// ont disparu avec son depart, l'acceptation precedente ne vaut plus rien.
	//
	// `battlenetVerifiedAt` est remis a `null` pour la meme raison — mais le lien
	// Battle.net lui-meme (`battlenet_accounts`) survit : il n'y a aucune raison
	// de faire rescanner un compte deja prouve, et l'unicite doit continuer de
	// tenir pendant l'absence.
	await prisma.quarantineStatus.upsert({
		where: {
			guildId_userId: { guildId: member.guild.id, userId: member.id },
		},
		update: {
			quarantinedAt: new Date(),
			acceptedAt: null,
			battlenetVerifiedAt: null,
			releasedById: null,
			discordSyncedAt: new Date(),
		},
		create: {
			guildId: member.guild.id,
			userId: member.id,
			// Le role vient d'etre pose par cet appel : rien a rattraper.
			discordSyncedAt: new Date(),
		},
	});
}

/**
 * Jeu de roles correspondant a l'etape atteinte.
 *
 * Le role de quarantaine ne part qu'a `CLEARED` : c'est lui qui ferme le
 * serveur, le retirer plus tot reviendrait a n'avoir aucune seconde etape.
 */
export function lotPourEtape(
	config: ReglageEtapes,
	stage: QuarantineStage,
): LotDeRoles {
	switch (stage) {
		case QuarantineStage.CLEARED:
			return {
				addRoleIds: config.releaseAddRoleIds,
				removeRoleIds: [
					...config.releaseRemoveRoleIds,
					// Les roles intermediaires n'ont plus lieu d'etre : ils decrivaient
					// une etape en cours. Les laisser ferait cohabiter « en attente de
					// verification » et l'acces complet sur la meme fiche.
					...config.acceptAddRoleIds,
					...config.verifyAddRoleIds,
					...(config.roleId ? [config.roleId] : []),
				],
			};
		case QuarantineStage.ACCEPTED_ONLY:
			return {
				addRoleIds: config.acceptAddRoleIds,
				removeRoleIds: config.acceptRemoveRoleIds,
			};
		case QuarantineStage.VERIFIED_ONLY:
			return {
				addRoleIds: config.verifyAddRoleIds,
				removeRoleIds: config.verifyRemoveRoleIds,
			};
		case QuarantineStage.PENDING:
			return { addRoleIds: [], removeRoleIds: [] };
	}
}

/**
 * Un role n'est modifiable que s'il n'est ni gere par une integration (role de
 * bot, role de boost) ni place au-dessus du plus haut role du bot. Meme regle
 * que `partitionRoles` du shadowban, et pour la meme raison : `roles.set` est
 * un appel unique, un seul role interdit ferait echouer la levee entiere.
 */
function gerable(role: Role | null | undefined, botHighest: Role | null): boolean {
	if (!role) return false;
	return (
		!role.managed && botHighest !== null && role.comparePositionTo(botHighest) < 0
	);
}

/**
 * Applique un lot de roles en **un seul** `roles.set`.
 *
 * Un `remove` suivi d'un `add` ferait traverser au membre un etat ou il a quitte
 * la quarantaine sans avoir encore le role qui ouvre le serveur — un arrivant y
 * verrait un serveur vide pendant le temps d'un aller-retour reseau, et un echec
 * entre les deux appels l'y laisserait pour de bon.
 *
 * Un role que le bot ne peut pas modifier est **ignore, pas fatal** : la levee
 * doit aboutir meme si un role de la liste a depuis ete deplace au-dessus du
 * bot. Le journal le signale, car un role configure qui ne s'applique jamais
 * passerait autrement pour un bug du bouton.
 */
export async function appliquerRoles(
	member: GuildMember,
	lot: LotDeRoles,
	raison: string,
): Promise<void> {
	const botHighest = member.guild.members.me?.roles.highest ?? null;

	const aRetirer = new Set<string>(lot.removeRoleIds);
	const final = new Set<string>();

	for (const role of member.roles.cache.values()) {
		// `@everyone` porte l'identifiant du serveur et n'est jamais transmis.
		if (role.id === member.guild.id) continue;

		if (aRetirer.has(role.id)) {
			// Hors de portee du bot : on le laisse dans le lot pour que Discord n'y
			// voie aucun changement, plutot que de faire echouer l'appel entier.
			if (!gerable(role, botHighest)) {
				console.warn(
					`[Quarantaine] Rôle ${role.id} non retirable à ${member.id} (géré ou au-dessus du bot).`,
				);
				final.add(role.id);
			}
			continue;
		}

		final.add(role.id);
	}

	for (const roleId of lot.addRoleIds) {
		if (aRetirer.has(roleId)) continue;

		const role =
			member.guild.roles.cache.get(roleId) ??
			(await member.guild.roles.fetch(roleId).catch(() => null));

		if (!gerable(role, botHighest)) {
			console.warn(
				`[Quarantaine] Rôle ${roleId} non attribuable à ${member.id} (introuvable, géré ou au-dessus du bot).`,
			);
			continue;
		}

		final.add(roleId);
	}

	await member.roles.set([...final], raison);
}

/**
 * Applique a un membre les roles de l'etape ou il se trouve.
 *
 * Point d'entree unique des deux chemins (bouton et rattrapage) : c'est ce qui
 * garantit qu'une verification faite depuis le navigateur aboutit exactement au
 * meme etat qu'un clic sur Discord.
 */
async function appliquerEtape(
	member: GuildMember,
	config: ReglageEtapes,
	statut: {
		acceptedAt: Date | null;
		battlenetVerifiedAt: Date | null;
		releasedById: string | null;
	},
	raison: string,
): Promise<QuarantineStage> {
	const stage = quarantineStage(statut, config.battlenetRequired);
	await appliquerRoles(member, lotPourEtape(config, stage), raison);
	return stage;
}

/**
 * Acceptation du reglement par le membre lui-meme (bouton).
 *
 * Les roles sont poses ici, donc `discordSyncedAt` l'est dans la foulee — y
 * compris quand l'etape suivante manque encore : le bot a applique tout ce qui
 * lui incombait, il n'y a rien a rattraper avant la verification.
 */
export async function accepterReglement(
	member: GuildMember,
): Promise<ResultatAcceptation> {
	const config = await configActive(member.guild.id);
	if (!config?.roleId) return "hors-service";

	const statut = await prisma.quarantineStatus.findUnique({
		where: {
			guildId_userId: { guildId: member.guild.id, userId: member.id },
		},
	});

	if (statut?.acceptedAt) {
		const etat = quarantineStage(statut, config.battlenetRequired);

		// Un second clic ne refait rien — sauf si le role de quarantaine est
		// toujours la alors que toutes les etapes sont franchies. C'est le signe
		// d'un `roles.set` qui a echoue plus tot, et ce clic le repare : sans ce
		// rattrapage, le membre resterait bloque avec le seul bouton qui aurait pu
		// le liberer lui repondant qu'il a deja accepte.
		const aReparer =
			etat === QuarantineStage.CLEARED && member.roles.cache.has(config.roleId);

		if (!aReparer) return "deja-acceptee";
	}

	const maintenant = new Date();

	await appliquerEtape(
		member,
		config,
		{
			acceptedAt: maintenant,
			battlenetVerifiedAt: statut?.battlenetVerifiedAt ?? null,
			releasedById: statut?.releasedById ?? null,
		},
		"Règlement accepté.",
	);

	await prisma.quarantineStatus.upsert({
		where: {
			guildId_userId: { guildId: member.guild.id, userId: member.id },
		},
		update: { acceptedAt: maintenant, discordSyncedAt: maintenant },
		create: {
			guildId: member.guild.id,
			userId: member.id,
			acceptedAt: maintenant,
			discordSyncedAt: maintenant,
		},
	});

	return "acceptee";
}

/**
 * Etapes franchies ailleurs que sur Discord, pas encore rejouees cote roles :
 * verification Battle.net faite dans le navigateur, levee prononcee depuis la
 * webapp.
 *
 * Le filtre porte sur le seul `discordSyncedAt: null`, sans condition sur
 * `acceptedAt` : avec deux etapes, une verification faite avant l'acceptation
 * doit elle aussi remonter, or elle laisse `acceptedAt` a `null`. Aucune ligne
 * en attente n'echappe ainsi au rattrapage — l'arrivee et le clic sur un bouton
 * posent tous deux la date eux-memes.
 *
 * Le membre peut avoir quitte le serveur entre-temps : l'entree est alors
 * marquee synchronisee malgre tout, sinon elle reviendrait a chaque passage.
 */
export async function synchroniserQuarantaines(client: Client): Promise<void> {
	const pending = await prisma.quarantineStatus.findMany({
		where: { discordSyncedAt: null },
	});

	for (const statut of pending) {
		const guild = client.guilds.cache.get(statut.guildId);
		if (!guild) continue;

		try {
			await rejouerEtape(guild, statut);

			await prisma.quarantineStatus.update({
				where: {
					guildId_userId: {
						guildId: statut.guildId,
						userId: statut.userId,
					},
				},
				data: { discordSyncedAt: new Date() },
			});
		} catch (err) {
			console.error(
				`[Quarantaine] Mise à jour des rôles de ${statut.userId} échouée :`,
				err,
			);
		}
	}
}

async function rejouerEtape(
	guild: Guild,
	statut: {
		userId: string;
		acceptedAt: Date | null;
		battlenetVerifiedAt: Date | null;
		releasedById: string | null;
	},
): Promise<void> {
	const config = await prisma.quarantineConfig.findUnique({
		where: { guildId: guild.id },
	});
	if (!config?.roleId) return;

	const member = await guild.members.fetch(statut.userId).catch(() => null);
	if (!member) return;

	await appliquerEtape(
		member,
		config,
		statut,
		statut.releasedById
			? "Quarantaine levée depuis le dashboard."
			: "Étape de quarantaine franchie.",
	);
}
