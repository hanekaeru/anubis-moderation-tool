import type { Guild, VoiceState } from "discord.js";
import prisma from "../prisma";
import * as referentiel from "./referentiel";

/**
 * Sessions vocales : une ligne par passage dans un salon vocal.
 *
 * Une session est ouverte a l'arrivee (`leftAt = null`) puis fermee au depart,
 * avec sa duree calculee. Un changement de salon ferme la session precedente et
 * en ouvre une nouvelle : la fiche membre doit pouvoir dire dans quel salon le
 * temps a ete passe, pas seulement combien de temps au total.
 *
 * Comme partout ailleurs, deux modes se completent — les evenements au fil de
 * l'eau, et une reconciliation au demarrage : personne ne genere d'evenement en
 * entrant ou en sortant d'un vocal pendant que le bot est eteint.
 */

/**
 * `guildId:userId` -> identifiant de la session ouverte.
 *
 * Evite une requete de recherche a chaque mouvement, sur le meme principe que
 * le cache `channelId -> ticketId` des tickets. Repeuple au demarrage par
 * `reconcilierSessions`.
 */
const sessionsOuvertes = new Map<string, bigint>();

function cle(guildId: string, userId: string): string {
	return `${guildId}:${userId}`;
}

function dureeSecondes(joinedAt: Date, leftAt: Date): number {
	return Math.max(0, Math.round((leftAt.getTime() - joinedAt.getTime()) / 1000));
}

/** Ferme une session en base et calcule sa duree. */
async function fermer(
	session: { id: bigint; joinedAt: Date },
	leftAt: Date,
): Promise<void> {
	await prisma.voiceSession.update({
		where: { id: session.id },
		data: { leftAt, durationSeconds: dureeSecondes(session.joinedAt, leftAt) },
	});
}

async function ouvrirSession(state: VoiceState): Promise<void> {
	const channel = state.channel;
	if (!channel) return;

	const membre =
		state.member ??
		(await state.guild.members.fetch(state.id).catch(() => null));
	if (!membre) return;

	// `voice_sessions` porte des cles etrangeres vers le serveur, le membre et
	// le salon : ils doivent exister avant l'ecriture.
	const contexteOk = await referentiel.garantirContexte(
		state.guild,
		membre.user,
	);
	if (!contexteOk) return;
	await referentiel.upsertChannel(channel);

	const session = await prisma.voiceSession.create({
		data: {
			guildId: state.guild.id,
			userId: membre.id,
			channelId: channel.id,
			joinedAt: new Date(),
		},
		select: { id: true },
	});

	sessionsOuvertes.set(cle(state.guild.id, membre.id), session.id);
}

async function fermerSession(
	guildId: string,
	userId: string,
	leftAt: Date,
): Promise<void> {
	const identifiant = sessionsOuvertes.get(cle(guildId, userId));
	sessionsOuvertes.delete(cle(guildId, userId));

	// Sans identifiant en cache — un depart survenu juste apres un redemarrage,
	// avant que la reconciliation n'ait repeuple le cache — la session ouverte
	// est retrouvee en base.
	const session =
		identifiant !== undefined
			? await prisma.voiceSession.findUnique({
					where: { id: identifiant },
					select: { id: true, joinedAt: true, leftAt: true },
				})
			: await prisma.voiceSession.findFirst({
					where: { guildId, userId, leftAt: null },
					orderBy: { joinedAt: "desc" },
					select: { id: true, joinedAt: true, leftAt: true },
				});

	if (!session || session.leftAt) return;
	await fermer(session, leftAt);
}

export interface OptionsMouvement {
	/**
	 * Le salon rejoint n'est qu'un sas : aucune session n'y est ouverte.
	 *
	 * C'est le cas des salons vocaux « de creation » (voir
	 * `collectors/voiceHubs.ts`), que le bot quitte pour l'arrivant dans la
	 * milliseconde. Sans cela, chaque partie laisserait une session de zero
	 * seconde dans l'historique du membre.
	 */
	sasDArrivee?: boolean;
}

/**
 * Point d'entree de l'evenement `voiceStateUpdate`.
 *
 * Seul le salon compte : couper son micro, son casque ou lancer un partage
 * d'ecran declenche aussi cet evenement, sans qu'aucune session ne commence ni
 * ne se termine.
 */
export async function enregistrerMouvement(
	oldState: VoiceState,
	newState: VoiceState,
	options: OptionsMouvement = {},
): Promise<void> {
	const avant = oldState.channelId;
	const apres = newState.channelId;
	if (avant === apres) return;

	const maintenant = new Date();

	if (avant) await fermerSession(oldState.guild.id, oldState.id, maintenant);
	if (apres && !options.sasDArrivee) await ouvrirSession(newState);
}

/**
 * Occupants actuels d'un salon, du plus ancien arrive au plus recent.
 *
 * Lu dans les sessions encore ouvertes plutot que dans le cache Discord : c'est
 * la meme source que le reste du suivi vocal, et elle porte l'ordre d'arrivee
 * dont depend le transfert de propriete d'un salon temporaire.
 */
export async function occupantsDuSalon(
	guildId: string,
	channelId: string,
): Promise<{ userId: string; joinedAt: Date }[]> {
	return prisma.voiceSession.findMany({
		where: { guildId, channelId, leftAt: null },
		orderBy: { joinedAt: "asc" },
		select: { userId: true, joinedAt: true },
	});
}

/**
 * Remet l'etat des sessions a plat au demarrage.
 *
 * `finProbable` est la date de fin attribuee aux sessions restees ouvertes
 * pendant l'arret. L'appelant y passe le dernier battement connu du bot plutot
 * que l'heure courante : sans cela, un arret de plusieurs jours produirait des
 * sessions vocales de plusieurs jours.
 */
export async function reconcilierSessions(
	guild: Guild,
	finProbable: Date,
): Promise<void> {
	const ouvertes = await prisma.voiceSession.findMany({
		where: { guildId: guild.id, leftAt: null },
		select: { id: true, userId: true, channelId: true, joinedAt: true },
	});

	const presents = new Map<string, VoiceState>();
	for (const state of guild.voiceStates.cache.values()) {
		if (state.channelId) presents.set(state.id, state);
	}

	let fermees = 0;

	for (const session of ouvertes) {
		const state = presents.get(session.userId);

		// Toujours connecte au meme salon : la session se poursuit reellement,
		// seul le cache memoire est a repeupler.
		if (state && state.channelId === session.channelId) {
			sessionsOuvertes.set(cle(guild.id, session.userId), session.id);
			presents.delete(session.userId);
			continue;
		}

		// Une session ouverte apres le dernier battement (redemarrage rapide) ne
		// doit pas se voir attribuer une fin anterieure a son debut.
		const leftAt =
			finProbable > session.joinedAt ? finProbable : session.joinedAt;
		await fermer(session, leftAt);
		fermees += 1;
	}

	// Ce qui reste dans `presents` est connecte sans session ouverte : arrive
	// pendant l'arret du bot, ou session close ci-dessus pour changement de
	// salon.
	const restants = Array.from(presents.values());
	for (const state of restants) {
		await ouvrirSession(state);
	}

	if (fermees || restants.length) {
		console.log(
			`[Vocal] ${guild.name} : ${fermees} session(s) close(s), ${restants.length} reprise(s).`,
		);
	}
}

/**
 * Ferme les sessions en cours avant un arret propre.
 *
 * Sans ce filet, la reconciliation du prochain demarrage les fermerait sur le
 * dernier battement — une approximation acceptable apres un plantage, mais
 * inutile quand l'arret est connu a la seconde pres.
 */
export async function fermerSessionsEnCours(): Promise<void> {
	const identifiants = Array.from(sessionsOuvertes.values());
	sessionsOuvertes.clear();
	if (!identifiants.length) return;

	const maintenant = new Date();
	const sessions = await prisma.voiceSession.findMany({
		where: { id: { in: identifiants }, leftAt: null },
		select: { id: true, joinedAt: true },
	});

	await prisma.$transaction(
		sessions.map((session) =>
			prisma.voiceSession.update({
				where: { id: session.id },
				data: {
					leftAt: maintenant,
					durationSeconds: dureeSecondes(session.joinedAt, maintenant),
				},
			}),
		),
	);

	console.log(`[Vocal] ${sessions.length} session(s) close(s) avant l'arrêt.`);
}
