import {
	AttachmentBuilder,
	EmbedBuilder,
	type Client,
	type Guild,
	type GuildTextBasedChannel,
	type Message,
	type User,
} from "discord.js";
import {
	MINIGAME_DEFAULT_POLL_QUESTIONS,
	MINIGAME_TRUE_FALSE_ANSWERS,
	MINIGAME_TYPE_EMOJIS,
	MINIGAME_TYPE_LABELS,
	MinigameType,
	isGuessMinigame,
	isPollMinigame,
	minigameAnswerLabel,
	minigameDayEnd,
	minigameDayKey,
	minigamePingInstant,
	minigamePollHours,
	renderMinigameEndAnnouncement,
} from "@anubis/shared";
import { Prisma, type MinigameEvent, type MinigameImage } from "@anubis/shared/prisma";
import { maintenant } from "../collectors/minigameClock";
import * as minigames from "../collectors/minigames";
import * as referentiel from "../collectors/referentiel";
import xpManager from "../collectors/xp";
import { celebrerMontee } from "../collectors/xpLevelUp";
import prisma from "../prisma";

/**
 * Cycle de vie des mini-jeux sur Discord, rejoue toutes les cinq secondes.
 *
 * Quatre etapes, chacune lue sur une date de la ligne, dans l'ordre ou elles
 * doivent apparaitre dans le salon :
 *
 * 1. **fermeture** (`closedAt` nul, jour J termine) — XP du vrai ou faux
 *    d'apres les votes finaux, annonce de fin sans ping. Avant la publication
 *    du lendemain, qui tombe dans le meme passage a minuit.
 * 2. **publication** (`publishedAt` nul, jour J commence) — embed et images,
 *    puis le sondage dans un message a part : un sondage Discord ne se modifie
 *    plus, l'embed doit rester corrigeable. Aucun ping a minuit.
 * 3. **correction** (`discordSyncedAt` nul apres publication) — l'embed est
 *    edite en place, images comprises.
 * 4. **ping** (`pingedAt` nul, heure du ping passee) — un message **separe** :
 *    une mention ajoutee en editant un message ne notifie personne.
 *
 * Un jeu jamais publie (bot eteint toute la journee) n'est pas rattrape le
 * lendemain : jouer hors de sa journee n'aurait aucun sens.
 */

/** Les passages se chevaucheraient sur une publication lente : un seul a la fois. */
let enCours = false;

/**
 * Une publication refusee est retentee au plus une fois par minute : sans ce
 * delai, un salon mal regle produirait une erreur toutes les cinq secondes.
 */
const DELAI_NOUVEL_ESSAI_MS = 60_000;
const echecs = new Map<string, number>();

type JeuAvecImages = MinigameEvent & { images: MinigameImage[] };

export async function synchroniserMiniJeux(client: Client, now = maintenant()): Promise<void> {
	if (enCours) return;
	enCours = true;
	try {
		for (const guild of client.guilds.cache.values()) {
			await synchroniserServeur(guild, now).catch((err) => {
				console.error(`[Mini-jeux] Synchronisation échouée sur ${guild.name} :`, err);
			});
		}
	} finally {
		enCours = false;
	}
}

const versDate = (key: string) => new Date(`${key}T00:00:00Z`);
const versCle = (date: Date) => date.toISOString().slice(0, 10);

function raison(err: unknown): string {
	return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

async function salon(guild: Guild, channelId: string | null): Promise<GuildTextBasedChannel | null> {
	if (!channelId) return null;
	const channel = await guild.channels.fetch(channelId).catch(() => null);
	return channel?.isTextBased() ? channel : null;
}

async function synchroniserServeur(guild: Guild, now: Date): Promise<void> {
	const aujourdhui = minigameDayKey(now);
	// Relu sans cache : le staff vient peut-etre de regler le salon d'annonce.
	const config = await minigames.reglage(guild.id, true);

	// 1. Fermeture de la veille, **avant** la publication du jour : les deux
	// tombent dans le meme passage a minuit, et dans l'ordre inverse l'annonce
	// « C'était… » d'hier s'intercalait entre le jeu du jour et son ping.
	const aFermer = await prisma.minigameEvent.findMany({
		where: { guildId: guild.id, publishedAt: { not: null }, closedAt: null, day: { lt: versDate(aujourdhui) } },
	});
	for (const jeu of aFermer) {
		// Garde : la cle du jour change a minuit pile, la fin aussi.
		if (now < minigameDayEnd(versCle(jeu.day))) continue;
		await fermer(guild, jeu, config, now).catch(async (err) => {
			console.error(`[Mini-jeux] Fermeture du jeu ${jeu.id} échouée :`, err);
			await prisma.minigameEvent.update({
				where: { id: jeu.id },
				data: { closedAt: new Date(), lastError: raison(err) },
			});
		});
	}

	// 2. Publication du jeu du jour.
	const aPublier = await prisma.minigameEvent.findFirst({
		where: { guildId: guild.id, day: versDate(aujourdhui), publishedAt: null },
		include: { images: { orderBy: { position: "asc" } } },
	});
	if (aPublier && Date.now() - (echecs.get(aPublier.id) ?? 0) >= DELAI_NOUVEL_ESSAI_MS) {
		await publier(guild, aPublier, config, now).catch(async (err) => {
			echecs.set(aPublier.id, Date.now());
			console.error(`[Mini-jeux] Publication du jeu ${aPublier.id} échouée :`, err);
			await prisma.minigameEvent.update({ where: { id: aPublier.id }, data: { lastError: raison(err) } });
		});
	}

	// 3. Corrections demandees depuis le dashboard.
	const aCorriger = await prisma.minigameEvent.findMany({
		where: { guildId: guild.id, publishedAt: { not: null }, closedAt: null, discordSyncedAt: null },
		include: { images: { orderBy: { position: "asc" } } },
	});
	for (const jeu of aCorriger) {
		await corriger(guild, jeu, config).catch(async (err) => {
			console.error(`[Mini-jeux] Correction du jeu ${jeu.id} échouée :`, err);
			// Pose malgre l'echec, comme les messages composes : sans cela la
			// correction serait rejouee toutes les cinq secondes.
			await prisma.minigameEvent.update({
				where: { id: jeu.id },
				data: { discordSyncedAt: new Date(), lastError: raison(err) },
			});
		});
	}

	// 4. Ping du jour, a l'heure reglee.
	const aPinger = await prisma.minigameEvent.findFirst({
		where: { guildId: guild.id, day: versDate(aujourdhui), publishedAt: { not: null }, pingedAt: null },
	});
	if (aPinger && now >= minigamePingInstant(aujourdhui, config.pingTime)) {
		await pinger(guild, aPinger, config.pingRoleId).catch(async (err) => {
			console.error(`[Mini-jeux] Ping du jeu ${aPinger.id} échoué :`, err);
			// Un ping manque ne se rejoue pas : il arriverait en retard, puis en
			// boucle si le role a disparu.
			await prisma.minigameEvent.update({
				where: { id: aPinger.id },
				data: { pingedAt: new Date(), lastError: raison(err) },
			});
		});
	}
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

const EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

function fichiers(images: MinigameImage[]): AttachmentBuilder[] {
	return images.map(
		(image, i) =>
			new AttachmentBuilder(Buffer.from(image.data), {
				name: `image-${i + 1}.${EXTENSIONS[image.contentType] ?? "png"}`,
			}),
	);
}

/**
 * L'embed du jeu, et autant d'embeds vides que d'images supplementaires.
 *
 * Discord regroupe en galerie (quatre images au plus) les embeds d'un meme
 * message qui partagent la meme `url` : c'est la seule facon d'afficher
 * plusieurs grandes images sous un seul titre. L'url mene au salon de jeu, ou
 * au serveur s'il n'y en a pas.
 */
function embeds(guild: Guild, jeu: JeuAvecImages, config: minigames.MinigameSettings): EmbedBuilder[] {
	const type = jeu.type as MinigameType;
	const lien = config.playChannelId
		? `https://discord.com/channels/${guild.id}/${config.playChannelId}`
		: `https://discord.com/channels/${guild.id}`;

	const principal = new EmbedBuilder()
		.setColor(jeu.color)
		.setTitle(jeu.title)
		.setURL(lien)
		.setFooter({ text: `${MINIGAME_TYPE_EMOJIS[type]} ${MINIGAME_TYPE_LABELS[type]} · jusqu'à 23h59` });
	if (jeu.description) principal.setDescription(jeu.description);

	if (isGuessMinigame(type)) {
		const essais = jeu.maxAttempts ?? config.maxAttempts;
		const ou = config.playChannelId ? ` dans <#${config.playChannelId}>` : "";
		principal.addFields({
			name: "Comment jouer",
			value: `Propose ta réponse avec \`/devine\`${ou} — ${essais} essai${essais > 1 ? "s" : ""}.`,
		});
	} else if (isPollMinigame(type)) {
		principal.addFields({ name: "Comment jouer", value: "Vote dans le sondage juste en dessous ⬇️" });
	}

	const noms = fichiers(jeu.images).map((f) => f.name!);
	if (!noms.length) return [principal];
	principal.setImage(`attachment://${noms[0]}`);
	return [principal, ...noms.slice(1).map((nom) => new EmbedBuilder().setURL(lien).setImage(`attachment://${nom}`))];
}

// ---------------------------------------------------------------------------
// Etapes
// ---------------------------------------------------------------------------

async function publier(guild: Guild, jeu: JeuAvecImages, config: minigames.MinigameSettings, now: Date): Promise<void> {
	const channel = await salon(guild, config.announceChannelId);
	if (!channel) {
		throw new Error(
			config.announceChannelId
				? "Salon d'annonce introuvable ou non textuel."
				: "Aucun salon d'annonce n'est réglé pour les mini-jeux.",
		);
	}

	const message = await channel.send({ embeds: embeds(guild, jeu, config), files: fichiers(jeu.images) });

	let pollMessageId: string | null = null;
	const type = jeu.type as MinigameType;
	if (isPollMinigame(type)) {
		const reponses =
			type === MinigameType.TRUE_FALSE
				? [
						{ text: MINIGAME_TRUE_FALSE_ANSWERS[0], emoji: "✅" },
						{ text: MINIGAME_TRUE_FALSE_ANSWERS[1], emoji: "❌" },
					]
				: jeu.pollAnswers.map((text) => ({ text }));
		try {
			const sondage = await channel.send({
				poll: {
					question: {
						text: jeu.pollQuestion ?? MINIGAME_DEFAULT_POLL_QUESTIONS[type as "DUEL" | "TRUE_FALSE"],
					},
					answers: reponses,
					duration: minigamePollHours(now, minigameDayEnd(versCle(jeu.day))),
					allowMultiselect: false,
				},
			});
			pollMessageId = sondage.id;
		} catch (err) {
			// L'embed est parti : le republier en boucle serait pire. Le jeu est
			// marque publie, l'erreur s'affiche dans le dashboard.
			console.error(`[Mini-jeux] Sondage du jeu ${jeu.id} non publié :`, err);
			await enregistrerPublication(jeu.id, channel.id, message.id, null, `Sondage refusé par Discord : ${raison(err)}`);
			return;
		}
	}

	await enregistrerPublication(jeu.id, channel.id, message.id, pollMessageId, null);
	echecs.delete(jeu.id);
}

async function enregistrerPublication(
	id: string,
	channelId: string,
	messageId: string,
	pollMessageId: string | null,
	lastError: string | null,
): Promise<void> {
	await prisma.minigameEvent.update({
		where: { id },
		data: {
			channelId,
			messageId,
			pollMessageId,
			publishedAt: new Date(),
			discordSyncedAt: new Date(),
			lastError,
		},
	});
}

async function corriger(guild: Guild, jeu: JeuAvecImages, config: minigames.MinigameSettings): Promise<void> {
	const channel = await salon(guild, jeu.channelId);
	if (!channel) throw new Error("Salon de publication introuvable.");

	const payload = { embeds: embeds(guild, jeu, config), files: fichiers(jeu.images), attachments: [] };
	const existant = jeu.messageId ? await channel.messages.fetch(jeu.messageId).catch(() => null) : null;

	// Supprime a la main : on republie l'embed, le jeu doit exister quelque
	// part. Le sondage, lui, ne se republie pas — il porterait d'autres votes.
	const messageId = existant ? (await existant.edit(payload)).id : (await channel.send(payload)).id;

	await prisma.minigameEvent.update({
		where: { id: jeu.id },
		data: { messageId, discordSyncedAt: new Date(), lastError: null },
	});
}

async function pinger(guild: Guild, jeu: MinigameEvent, roleParDefaut: string | null): Promise<void> {
	const roleId = jeu.pingRoleId ?? roleParDefaut;
	const channel = await salon(guild, jeu.channelId);

	if (!jeu.pingEnabled || !roleId || !channel) {
		await prisma.minigameEvent.update({ where: { id: jeu.id }, data: { pingedAt: new Date() } });
		return;
	}

	const type = jeu.type as MinigameType;
	const message = await channel.send({
		content: `<@&${roleId}> ${MINIGAME_TYPE_EMOJIS[type]} Le mini-jeu du jour est ouvert : **${jeu.title}** !`,
		allowedMentions: { roles: [roleId], repliedUser: false },
		...(jeu.messageId ? { reply: { messageReference: jeu.messageId, failIfNotExists: false } } : {}),
	});

	await prisma.minigameEvent.update({
		where: { id: jeu.id },
		data: { pingedAt: new Date(), pingMessageId: message.id },
	});
}

async function fermer(guild: Guild, jeu: MinigameEvent, config: minigames.MinigameSettings, now: Date): Promise<void> {
	const type = jeu.type as MinigameType;
	const channel = await salon(guild, jeu.channelId);
	let erreur: string | null = null;

	let solved = 0;
	let participants = 0;
	let heroOnly = 0;

	if (isPollMinigame(type)) {
		const sondage = channel && jeu.pollMessageId ? await channel.messages.fetch(jeu.pollMessageId).catch(() => null) : null;
		if (sondage?.poll && !sondage.poll.resultsFinalized) {
			// Le sondage dure un nombre entier d'heures : il est arrete au moment
			// meme ou le jeu se ferme.
			await sondage.poll.end().catch((err) => console.error("[Mini-jeux] Arrêt du sondage échoué :", err));
		}

		if (type === MinigameType.TRUE_FALSE) {
			if (sondage?.poll) {
				const bilan = await recompenserVraiFaux(guild, jeu, sondage, config, channel!, now);
				solved = bilan.solved;
				participants = bilan.participants;
			} else {
				erreur = "Sondage introuvable : aucune expérience n'a été distribuée.";
			}
		}
	} else if (isGuessMinigame(type)) {
		[participants, solved, heroOnly] = await Promise.all([
			prisma.minigameGame.count({ where: { eventId: jeu.id, attempts: { gt: 0 } } }),
			prisma.minigameGame.count({ where: { eventId: jeu.id, solvedAt: { not: null } } }),
			prisma.minigameGame.count({ where: { eventId: jeu.id, solvedAt: null, heroFoundAt: { not: null } } }),
		]);
	}

	const noms = await minigames.nomsDeReponse(jeu);
	const texte = renderMinigameEndAnnouncement({
		type,
		answer: minigameAnswerLabel(jeu, noms.hero, noms.map),
		solved,
		heroOnly,
		participants,
	});

	let endMessageId: string | null = null;
	if (texte && channel) {
		const annonce = await channel.send({
			content: texte,
			// Ni ping ni notification de reponse : la fin se lit, elle ne derange pas.
			allowedMentions: { parse: [], repliedUser: false },
			...(jeu.messageId ? { reply: { messageReference: jeu.messageId, failIfNotExists: false } } : {}),
		});
		endMessageId = annonce.id;
	} else if (texte) {
		erreur = "Salon de publication introuvable : l'annonce de fin n'est pas partie.";
	}

	await prisma.minigameEvent.update({
		where: { id: jeu.id },
		data: { closedAt: new Date(), endMessageId, ...(erreur ? { lastError: erreur } : {}) },
	});
}

/** Tous les votants d'une reponse, page par page (Discord en rend 100 au plus). */
async function votants(sondage: Message, answerId: number): Promise<User[]> {
	const reponse = sondage.poll?.answers.get(answerId);
	if (!reponse || !("voters" in reponse)) return [];

	const tous: User[] = [];
	let apres: string | undefined;
	for (;;) {
		const page = await reponse.voters.fetch({ limit: 100, ...(apres ? { after: apres } : {}) });
		tous.push(...page.values());
		if (page.size < 100) break;
		apres = page.lastKey();
	}
	return tous.filter((user) => !user.bot);
}

/**
 * Verse l'experience du vrai ou faux, d'apres les votes **finaux** : un membre
 * peut changer d'avis jusqu'a la fin, rien ne se decide avant.
 *
 * Une ligne `minigame_games` par votant, creee une seule fois : si la fermeture
 * echoue a mi-chemin et se rejoue, le conflit de cle primaire empeche de payer
 * deux fois ceux qui l'ont deja ete.
 */
async function recompenserVraiFaux(
	guild: Guild,
	jeu: MinigameEvent,
	sondage: Message,
	config: minigames.MinigameSettings,
	channel: GuildTextBasedChannel,
	now: Date,
): Promise<{ solved: number; participants: number }> {
	// Le bot publie toujours « Vrai » puis « Faux » : identifiants 1 et 2.
	const ids = [...sondage.poll!.answers.keys()].sort((a, b) => a - b);
	const bonne = ids[jeu.answerTrue ? 0 : 1];
	const mauvaise = ids[jeu.answerTrue ? 1 : 0];
	if (bonne === undefined || mauvaise === undefined) {
		throw new Error("Le sondage n'a pas les deux réponses attendues.");
	}

	const gagnants = await votants(sondage, bonne);
	const perdants = await votants(sondage, mauvaise);
	const libelle = (correct: boolean) => MINIGAME_TRUE_FALSE_ANSWERS[jeu.answerTrue === correct ? 0 : 1];

	for (const [user, correct] of [
		...gagnants.map((u) => [u, true] as const),
		...perdants.map((u) => [u, false] as const),
	]) {
		try {
			await referentiel.upsertUser(user);
			const xp = correct ? config.trueFalseXp : 0;
			await prisma.minigameGame.create({
				data: {
					eventId: jeu.id,
					userId: user.id,
					guesses: [libelle(correct)],
					attempts: 1,
					solvedAt: correct ? now : null,
					xpAwarded: xp,
				},
			});
			if (xp > 0) {
				const { before, after } = await xpManager.addXp(user.id, guild.id, xp);
				if (after.level > before.level) {
					const member = await guild.members.fetch(user.id).catch(() => null);
					if (member) await celebrerMontee(member, after.level, channel);
				}
			}
		} catch (err) {
			if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
			console.error(`[Mini-jeux] Vote de ${user.id} non enregistré :`, err);
		}
	}

	return { solved: gagnants.length, participants: gagnants.length + perdants.length };
}
