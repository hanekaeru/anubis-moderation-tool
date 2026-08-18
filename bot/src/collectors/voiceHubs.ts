import {
	ChannelType,
	PermissionFlagsBits,
	type CategoryChannel,
	type Guild,
	type VoiceBasedChannel,
	type VoiceState,
} from "discord.js";
import { renderVoiceStatus } from "@anubis/shared";
import type {
	TemporaryVoiceChannel,
	VoiceHub,
	VoiceHubPlatform,
	VoiceHubRank,
} from "@anubis/shared/prisma";
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

/**
 * Plafond Discord de salons dans une categorie.
 *
 * Il est atteint sans prevenir : la requete de deplacement echoue en 50035 et
 * le salon reste ou il est. Le compter avant permet de le dire au
 * proprietaire, qui saura choisir un autre rang.
 */
export const MAX_CHANNELS_PER_CATEGORY = 50;

/** Categorie ou `/create_parties` place les salons de creation. */
export const PARTIES_CATEGORY_NAME = "🗺️ • Protocole de communication";

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
 * Rangs et plateformes proposes par un salon de creation.
 *
 * Relus a chaque ouverture de la modale, sans cache : les options se comptent
 * en quelques-unes et un rang ajoute depuis le dashboard doit apparaitre au
 * clic suivant, pas au redemarrage du bot.
 */
export async function chargerOptions(hubId: string): Promise<{
	ranks: VoiceHubRank[];
	platforms: VoiceHubPlatform[];
}> {
	const [ranks, platforms] = await Promise.all([
		prisma.voiceHubRank.findMany({
			where: { hubId },
			orderBy: { position: "asc" },
		}),
		prisma.voiceHubPlatform.findMany({
			where: { hubId },
			orderBy: { position: "asc" },
		}),
	]);

	return { ranks, platforms };
}

/**
 * Pose le sujet du salon (« voice status »), celui qui s'affiche sous son nom.
 *
 * discord.js n'expose pas cette route : l'appel part en brut. Le rang et la
 * plateforme y vivent plutot que dans le nom, que Discord ne laisse changer
 * que deux fois par tranche de dix minutes — un proprietaire qui corrige son
 * rang puis sa plateforme atteindrait le plafond du premier coup.
 *
 * Demande la permission `SetVoiceChannelStatus`, verifiee par
 * `permissionsManquantes`.
 */
export async function definirSujet(
	salon: VoiceBasedChannel,
	sujet: string,
): Promise<void> {
	await salon.client.rest
		.put(`/channels/${salon.id}/voice-status`, {
			body: { status: sujet || null },
		})
		.catch((err: unknown) => {
			console.error("[Vocaux] Sujet du salon refusé par Discord :", err);
		});
}

/** Recompose le sujet a partir du gabarit du hub et des choix courants. */
function composerSujet(
	hub: Pick<VoiceHub, "statusPattern">,
	rank: VoiceHubRank | null,
	platform: VoiceHubPlatform | null,
	topic: string | null,
): string {
	return renderVoiceStatus(hub.statusPattern, { rank, platform, topic });
}

/** Categorie d'accueil quand le salon n'a aucun rang : celle de son hub. */
async function categorieDuHub(
	guild: Guild,
	hub: VoiceHub,
): Promise<string | null> {
	if (!hub.channelId) return null;
	const salonHub = await guild.channels.fetch(hub.channelId).catch(() => null);
	return salonHub?.parentId ?? null;
}

/**
 * Deplace un salon vers la categorie d'un rang, ou explique pourquoi il ne
 * peut pas l'etre.
 *
 * `lockPermissions: false` est le point sensible : synchroniser les
 * permissions sur la nouvelle categorie effacerait les surcharges du salon —
 * le verrou du panneau sauterait a chaque changement de rang, et l'acces
 * garanti du proprietaire avec lui.
 */
async function deplacerVers(
	salon: VoiceBasedChannel,
	categoryId: string | null,
): Promise<string | null> {
	if (salon.parentId === categoryId) return null;

	if (categoryId) {
		const categorie = await salon.guild.channels
			.fetch(categoryId)
			.catch(() => null);

		if (categorie?.type !== ChannelType.GuildCategory) {
			return "La catégorie configurée pour ce rang est introuvable. Préviens le staff.";
		}

		if ((categorie as CategoryChannel).children.cache.size >= MAX_CHANNELS_PER_CATEGORY) {
			return `La catégorie « ${categorie.name} » est pleine (${MAX_CHANNELS_PER_CATEGORY} salons). Choisis un autre rang ou attends qu'une place se libère.`;
		}
	}

	try {
		await salon.setParent(categoryId, {
			lockPermissions: false,
			reason: "Rang du salon temporaire modifié.",
		});
	} catch (err) {
		console.error("[Vocaux] Déplacement du salon temporaire échoué :", err);
		return "Discord a refusé de déplacer le salon. Préviens le staff.";
	}

	return null;
}

/**
 * Sujet tel qu'il devrait etre affiche pour un salon donne.
 *
 * Relu depuis la base plutot que garde en memoire : le panneau se rafraichit
 * aussi sur des actions qui ne touchent pas au sujet (verrouillage), et il ne
 * doit pas pour autant l'effacer de l'affichage.
 */
export async function sujetDuSalon(
	temporaire: TemporaryVoiceChannel,
): Promise<string> {
	const ligne = await prisma.temporaryVoiceChannel.findUnique({
		where: { id: temporaire.id },
		include: { hub: true, rank: true, platform: true },
	});
	if (!ligne) return "";

	return composerSujet(ligne.hub, ligne.rank, ligne.platform, ligne.topic);
}

/** Choix soumis par le proprietaire depuis la modale de personnalisation. */
export interface ChoixPersonnalisation {
	/** `null` retire le rang : le salon repart dans la categorie de son hub. */
	rankId: string | null;
	platformId: string | null;
	topic: string | null;
	/** `null` laisse la limite inchangee. */
	userLimit: number | null;
}

export interface ResultatPersonnalisation {
	rank: VoiceHubRank | null;
	platform: VoiceHubPlatform | null;
	sujet: string;
	/** Message a montrer au proprietaire quand le rangement n'a pas pu se faire. */
	avertissement: string | null;
}

/**
 * Applique en un seul point les choix de personnalisation d'un salon.
 *
 * L'ordre compte : le deplacement d'abord, l'ecriture en base ensuite, le
 * sujet en dernier. Si Discord refuse le deplacement, le rang n'est pas
 * enregistre — un rang en base pointant vers une categorie que le salon n'a
 * jamais rejointe ferait mentir la fiche du salon et le rattrapage du
 * demarrage le deplacerait plus tard, sans que personne ne l'ait demande.
 *
 * Le nom, lui, n'est jamais touche : il reste celui du gabarit du hub.
 */
export async function appliquerPersonnalisation(
	salon: VoiceBasedChannel,
	temporaire: TemporaryVoiceChannel,
	choix: ChoixPersonnalisation,
): Promise<ResultatPersonnalisation> {
	const hub = await prisma.voiceHub.findUnique({ where: { id: temporaire.hubId } });
	if (!hub) {
		return { rank: null, platform: null, sujet: "", avertissement: null };
	}

	// Les identifiants viennent du client : ils ne prouvent rien tant qu'on
	// n'a pas verifie qu'ils appartiennent bien a ce salon de creation.
	const [rank, platform] = await Promise.all([
		choix.rankId
			? prisma.voiceHubRank.findFirst({
					where: { id: choix.rankId, hubId: hub.id },
				})
			: null,
		choix.platformId
			? prisma.voiceHubPlatform.findFirst({
					where: { id: choix.platformId, hubId: hub.id },
				})
			: null,
	]);

	const rangDemande = choix.rankId !== temporaire.rankId;
	let avertissement: string | null = null;
	let rangApplique: VoiceHubRank | null = rank;

	if (rangDemande) {
		const cible = rank ? rank.categoryId : await categorieDuHub(salon.guild, hub);
		avertissement = await deplacerVers(salon, cible);

		// Le deplacement a echoue : on garde le rang precedent plutot que
		// d'enregistrer un rangement qui n'a pas eu lieu.
		if (avertissement) {
			rangApplique = temporaire.rankId
				? await prisma.voiceHubRank.findUnique({ where: { id: temporaire.rankId } })
				: null;
		}
	}

	if (choix.userLimit !== null && choix.userLimit !== salon.userLimit) {
		await salon
			.setUserLimit(choix.userLimit, "Modifié par le propriétaire.")
			.catch(() => undefined);
	}

	await prisma.temporaryVoiceChannel.update({
		where: { id: temporaire.id },
		data: {
			rankId: rangApplique?.id ?? null,
			platformId: platform?.id ?? null,
			topic: choix.topic,
		},
	});

	const sujet = composerSujet(hub, rangApplique, platform, choix.topic);
	await definirSujet(salon, sujet);

	return { rank: rangApplique, platform, sujet, avertissement };
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
		include: { hub: true, rank: true, platform: true },
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

		if (!salon.isVoiceBased()) continue;

		// La categorie d'un rang a pu changer depuis le dashboard pendant
		// l'arret, ou le rang disparaitre : le salon se remet a sa place.
		const attendue = temporaire.rank
			? temporaire.rank.categoryId
			: await categorieDuHub(guild, temporaire.hub);

		if (salon.parentId !== attendue) await deplacerVers(salon, attendue);

		// Discord efface le sujet quand un salon se vide : le reposer est la
		// seule facon qu'un salon repris apres l'arret retrouve le sien.
		await definirSujet(
			salon,
			composerSujet(
				temporaire.hub,
				temporaire.rank,
				temporaire.platform,
				temporaire.topic,
			),
		);
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
		// Le sujet du salon porte le rang et la plateforme : sans cette
		// permission, la personnalisation ne laisse aucune trace visible.
		[PermissionFlagsBits.SetVoiceChannelStatus, "Définir le sujet des salons vocaux"],
	];

	return requises
		.filter(([flag]) => !moi?.permissions.has(flag))
		.map(([, libelle]) => libelle);
}
