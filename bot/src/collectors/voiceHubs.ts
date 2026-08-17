import {
	ChannelType,
	PermissionFlagsBits,
	type Guild,
	type VoiceBasedChannel,
	type VoiceState,
} from "discord.js";
import type { TemporaryVoiceChannel, VoiceHub } from "@anubis/shared/prisma";
import prisma from "../prisma";
import { posterPanneau } from "../utils/voicePanel";
import * as referentiel from "./referentiel";
import * as voice from "./voice";
import * as voiceLog from "./voiceLog";

/**
 * Salons vocaux temporaires.
 *
 * Un « salon de creation » (`VoiceHub`) sert de sas : y entrer cree un salon
 * dedie et y deplace l'arrivant, qui en devient proprietaire. Quand le
 * proprietaire s'en va, la propriete passe au plus ancien occupant restant ;
 * quand le dernier occupant s'en va, le salon est supprime.
 *
 * L'occupation n'est jamais dupliquee : elle se lit dans les `VoiceSession`
 * encore ouvertes (`collectors/voice.ts`), deja tenues a jour au fil des
 * evenements et remises a plat au demarrage. C'est aussi ce qui donne l'ordre
 * d'arrivee dont depend le transfert de propriete.
 */

/** Categorie ou `/create_parties` place les salons de creation. */
export const PARTIES_CATEGORY_NAME = "Parties";

/**
 * Le hub est relu en base a chaque arrivee, sans cache.
 *
 * Les entrees en vocal se comptent en quelques-unes par minute, la ou un cache
 * ferait vivre un reglage desactive depuis le dashboard jusqu'a son expiration
 * — le contraire de ce qu'on attend d'un interrupteur.
 */
export async function trouverHub(
	guildId: string,
	channelId: string,
): Promise<VoiceHub | null> {
	return prisma.voiceHub.findFirst({
		where: { guildId, channelId, enabled: true },
	});
}

/** `{name}` et `{index}` remplaces dans le gabarit du hub. */
export function formaterNom(hub: VoiceHub, index: number): string {
	return hub.namePattern
		.replaceAll("{name}", hub.name)
		.replaceAll("{index}", String(index))
		.slice(0, 100);
}

/** Plus petit numero libre parmi les salons vivants du hub : `#2` ferme se reutilise. */
async function prochainIndex(hubId: string): Promise<number> {
	const vivants = await prisma.temporaryVoiceChannel.findMany({
		where: { hubId, closedAt: null },
		select: { index: true },
	});

	const pris = new Set(vivants.map((salon) => salon.index));
	let index = 1;
	while (pris.has(index)) index += 1;
	return index;
}

/**
 * Arrivee dans un salon de creation : creation du salon dedie et deplacement.
 *
 * Si le deplacement echoue — le membre a raccroche entre-temps, le bot n'a pas
 * la permission — le salon fraichement cree est detruit dans la foulee : le
 * laisser vide encombrerait le serveur sans que personne n'y entre jamais.
 */
export async function accueillirDansHub(
	hub: VoiceHub,
	state: VoiceState,
): Promise<void> {
	const membre = state.member;
	const salonHub = state.channel;
	if (!membre || !salonHub) return;

	await referentiel.upsertUser(membre.user);

	const index = await prochainIndex(hub.id);
	const name = formaterNom(hub, index);

	const salon = await state.guild.channels.create({
		name,
		type: ChannelType.GuildVoice,
		parent: salonHub.parentId,
		userLimit: hub.userLimit,
		position: salonHub.position + 1,
		permissionOverwrites: accesDeBase(state.guild, membre.id),
	});

	const temporaire = await prisma.temporaryVoiceChannel.create({
		data: {
			hubId: hub.id,
			guildId: state.guild.id,
			channelId: salon.id,
			name,
			index,
			ownerId: membre.id,
		},
	});

	try {
		await membre.voice.setChannel(salon, "Salon temporaire de partie.");
	} catch (err) {
		console.error("[Vocaux] Déplacement vers le salon temporaire échoué :", err);
		await salon.delete("Salon temporaire jamais rejoint.").catch(() => undefined);
		await prisma.temporaryVoiceChannel.update({
			where: { id: temporaire.id },
			data: { closedAt: new Date() },
		});
		return;
	}

	await posterPanneau(salon, membre.id);
	await voiceLog.salonCree(state.guild, salon, membre.user, hub);
}

/**
 * Depart d'un salon : transfert de propriete, ou suppression si plus personne.
 *
 * A appeler **apres** la fermeture de la session du partant, sinon il compte
 * encore parmi les occupants et le dernier salon ne serait jamais supprime.
 */
export async function quitterSalonTemporaire(
	guild: Guild,
	channelId: string,
	userId: string,
): Promise<void> {
	const temporaire = await prisma.temporaryVoiceChannel.findFirst({
		where: { channelId, closedAt: null },
	});
	if (!temporaire) return;

	const occupants = await voice.occupantsDuSalon(guild.id, channelId);
	const doyen = occupants[0];

	if (!doyen) {
		await supprimerSalon(guild, temporaire, "Salon vide.");
		return;
	}

	if (temporaire.ownerId !== userId) return;

	const successeur = doyen.userId;
	await prisma.temporaryVoiceChannel.update({
		where: { id: temporaire.id },
		data: { ownerId: successeur },
	});

	const salon = await guild.channels.fetch(channelId).catch(() => null);
	if (salon?.isVoiceBased()) {
		await transferrerAcces(salon, userId, successeur);
		await salon
			.send(`<@${successeur}> est désormais propriétaire de ce salon.`)
			.catch(() => undefined);
		await voiceLog.proprieteTransferee(guild, salon, userId, successeur);
	}
}

/** Supprime le salon Discord et clot la ligne, dans cet ordre pour rester idempotent. */
async function supprimerSalon(
	guild: Guild,
	temporaire: TemporaryVoiceChannel,
	raison: string,
): Promise<void> {
	const salon = await guild.channels.fetch(temporaire.channelId).catch(() => null);
	if (salon) await salon.delete(raison).catch(() => undefined);

	await prisma.temporaryVoiceChannel.update({
		where: { id: temporaire.id },
		data: { closedAt: new Date() },
	});

	await voiceLog.salonSupprime(guild, temporaire, raison);
}

/**
 * Suppression d'un salon dans Discord : la base suit, sans rien recreer.
 *
 * Un salon temporaire se referme ; un salon de creation ne perd que son
 * `channelId`, pour que le reglage survive et que `/create_parties` le recree
 * a l'identique.
 */
export async function oublierSalon(channelId: string): Promise<void> {
	await prisma.temporaryVoiceChannel.updateMany({
		where: { channelId, closedAt: null },
		data: { closedAt: new Date() },
	});

	await prisma.voiceHub.updateMany({
		where: { channelId },
		data: { channelId: null },
	});
}

/**
 * Remise a plat au demarrage.
 *
 * Rien de ce qui se passe bot eteint ne genere d'evenement : un salon a pu se
 * vider, disparaitre, ou perdre son proprietaire. A appeler **apres**
 * `voice.reconcilierSessions`, dont elle lit le resultat.
 */
export async function reconcilierSalons(guild: Guild): Promise<void> {
	const vivants = await prisma.temporaryVoiceChannel.findMany({
		where: { guildId: guild.id, closedAt: null },
	});

	let fermes = 0;

	for (const temporaire of vivants) {
		const salon = await guild.channels
			.fetch(temporaire.channelId)
			.catch(() => null);

		if (!salon) {
			await oublierSalon(temporaire.channelId);
			fermes += 1;
			continue;
		}

		const occupants = await voice.occupantsDuSalon(guild.id, temporaire.channelId);

		const doyen = occupants[0];

		if (!doyen) {
			await supprimerSalon(guild, temporaire, "Salon vide au démarrage.");
			fermes += 1;
			continue;
		}

		// Le proprietaire est parti pendant l'arret : la propriete revient au
		// plus ancien occupant encore la.
		if (!occupants.some((occupant) => occupant.userId === temporaire.ownerId)) {
			await prisma.temporaryVoiceChannel.update({
				where: { id: temporaire.id },
				data: { ownerId: doyen.userId },
			});
		}
	}

	if (fermes) {
		console.log(`[Vocaux] ${guild.name} : ${fermes} salon(s) temporaire(s) clos.`);
	}
}

/**
 * Cree les salons Discord des hubs actives qui n'en ont pas encore.
 *
 * Renvoie une ligne par hub pour la reponse de `/create_parties`.
 */
export async function creerSalonsDeCreation(guild: Guild): Promise<string[]> {
	const hubs = await prisma.voiceHub.findMany({
		where: { guildId: guild.id, enabled: true },
		orderBy: { position: "asc" },
	});

	if (!hubs.length) return [];

	const categorie = await garantirCategorie(guild);
	const lignes: string[] = [];

	for (const hub of hubs) {
		const existant = hub.channelId
			? await guild.channels.fetch(hub.channelId).catch(() => null)
			: null;

		if (existant) {
			lignes.push(`- ${existant} (déjà créé)`);
			continue;
		}

		const salon = await guild.channels.create({
			name: hub.name,
			type: ChannelType.GuildVoice,
			parent: categorie.id,
			userLimit: hub.userLimit,
		});

		await prisma.voiceHub.update({
			where: { id: hub.id },
			data: { channelId: salon.id },
		});

		lignes.push(`- ${salon} (créé)`);
	}

	return lignes;
}

/**
 * Supprime les salons Discord des hubs sans toucher aux reglages.
 *
 * C'est ce qui rend une mise a jour rapide : on efface, on modifie la liste
 * depuis le dashboard, on relance `/create_parties`.
 */
export async function supprimerSalonsDeCreation(guild: Guild): Promise<number> {
	const hubs = await prisma.voiceHub.findMany({
		where: { guildId: guild.id, channelId: { not: null } },
	});

	let supprimes = 0;

	for (const hub of hubs) {
		if (!hub.channelId) continue;

		const salon = await guild.channels.fetch(hub.channelId).catch(() => null);
		if (salon) {
			await salon.delete("Salons de création réinitialisés.").catch(() => undefined);
			supprimes += 1;
		}

		await prisma.voiceHub.update({
			where: { id: hub.id },
			data: { channelId: null },
		});
	}

	return supprimes;
}

/** Supprime tous les salons temporaires vivants — jamais les salons de creation. */
export async function purgerSalonsTemporaires(guild: Guild): Promise<number> {
	const vivants = await prisma.temporaryVoiceChannel.findMany({
		where: { guildId: guild.id, closedAt: null },
	});

	for (const temporaire of vivants) {
		await supprimerSalon(guild, temporaire, "Purge manuelle des salons temporaires.");
	}

	return vivants.length;
}

async function garantirCategorie(guild: Guild) {
	const existante = guild.channels.cache.find(
		(salon) =>
			salon.type === ChannelType.GuildCategory &&
			salon.name.toLowerCase() === PARTIES_CATEGORY_NAME.toLowerCase(),
	);

	if (existante) return existante;

	return guild.channels.create({
		name: PARTIES_CATEGORY_NAME,
		type: ChannelType.GuildCategory,
	});
}

/**
 * Permissions posees a la creation d'un salon temporaire.
 *
 * **Le bot doit s'accorder `Connect` explicitement**, sinon le verrouillage est
 * sans retour : refuser `Connect` a `@everyone` le lui retire aussi sur ce
 * salon, or Discord interdit de modifier une permission qu'on ne possede pas
 * soi-meme — l'appel de deverrouillage repartait en 50013.
 *
 * Le proprietaire recoit le meme acces, pour qu'un salon verrouille ne
 * l'enferme pas dehors s'il se deconnecte un instant.
 */
function accesDeBase(guild: Guild, ownerId: string) {
	return [
		{
			id: guild.members.me?.id ?? guild.client.user.id,
			allow: [
				PermissionFlagsBits.ViewChannel,
				PermissionFlagsBits.Connect,
				PermissionFlagsBits.ManageChannels,
				PermissionFlagsBits.MoveMembers,
			],
		},
		{ id: ownerId, allow: [PermissionFlagsBits.Connect] },
	];
}

/**
 * Verrouille ou deverrouille un salon temporaire pour `@everyone`.
 *
 * `Connect` repasse a `null` et non a `true` : rendre le salon explicitement
 * ouvert ecraserait une restriction posee ailleurs (confinement anti-raid,
 * permission de categorie).
 */
export async function definirVerrou(
	salon: VoiceBasedChannel,
	verrouille: boolean,
): Promise<void> {
	// Filet pour les salons crees avant que `accesDeBase` n'existe, et pour un
	// salon dont l'acces du bot aurait ete retire a la main : sans cette
	// reparation, le verrou pose ici ne pourrait plus jamais etre leve.
	await garantirAccesDuBot(salon);

	await salon.permissionOverwrites.edit(salon.guild.roles.everyone.id, {
		Connect: verrouille ? false : null,
	});

	await prisma.temporaryVoiceChannel.updateMany({
		where: { channelId: salon.id, closedAt: null },
		data: { locked: verrouille },
	});
}

async function garantirAccesDuBot(salon: VoiceBasedChannel): Promise<void> {
	const moi = salon.guild.members.me;
	if (!moi) return;

	await salon.permissionOverwrites.edit(moi.id, {
		ViewChannel: true,
		Connect: true,
		ManageChannels: true,
		MoveMembers: true,
	});
}

/**
 * Deplace l'acces garanti du proprietaire sortant vers le nouveau.
 *
 * Sans cela, un salon verrouille resterait ouvert a l'ancien proprietaire et
 * ferme au nouveau — exactement l'inverse de ce que le panneau annonce.
 */
export async function transferrerAcces(
	salon: VoiceBasedChannel,
	ancienId: string,
	nouveauId: string,
): Promise<void> {
	await salon.permissionOverwrites.delete(ancienId).catch(() => undefined);
	await salon.permissionOverwrites
		.edit(nouveauId, { Connect: true })
		.catch(() => undefined);
}

/** Le bot doit pouvoir creer, deplacer et regler les salons pour que tout ceci fonctionne. */
export function permissionsManquantes(guild: Guild): string[] {
	const moi = guild.members.me;
	const requises: [bigint, string][] = [
		[PermissionFlagsBits.ManageChannels, "Gérer les salons"],
		[PermissionFlagsBits.MoveMembers, "Déplacer les membres"],
		// Editer les permissions d'un salon (le verrou du panneau) demande
		// « Gérer les rôles » : sans elle, le bouton echoue sans rien dire.
		[PermissionFlagsBits.ManageRoles, "Gérer les rôles"],
	];

	return requises
		.filter(([flag]) => !moi?.permissions.has(flag))
		.map(([, libelle]) => libelle);
}
