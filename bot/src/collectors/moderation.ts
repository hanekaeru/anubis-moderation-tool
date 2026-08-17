import {
	INSTANT_SANCTION_TYPES,
	type SanctionType,
	type WarningSeverity,
} from "@anubis/shared";
import prisma from "../prisma";
import {
	pointsPourAvertissement,
	pointsPourSanction,
} from "./moderationPoints";

/**
 * Sanctions et avertissements.
 *
 * Miroir cote bot de `api/src/moderation/{sanctions,warnings}.service.ts` :
 * memes regles (statut instantane, calcul d'expiration), mais l'acteur est un
 * moderateur Discord (`moderatorId`) plutot qu'un compte dashboard
 * (`createdById`). Contrairement a `activite.ts`, pas de buffer ici — une
 * sanction s'ecrit immediatement, comme cote API.
 */

interface CreateSanctionInput {
	guildId: string;
	userId: string;
	moderatorId: string;
	type: SanctionType;
	reason: string;
	durationSeconds?: number | null;
}

export async function createSanction(input: CreateSanctionInput) {
	const startsAt = new Date();
	const isInstant = INSTANT_SANCTION_TYPES.includes(input.type);
	const durationSeconds = isInstant ? null : (input.durationSeconds ?? null);

	const sanction = await prisma.sanction.create({
		data: {
			guildId: input.guildId,
			userId: input.userId,
			moderatorId: input.moderatorId,
			type: input.type,
			reason: input.reason,
			durationSeconds,
			startsAt,
			expiresAt: durationSeconds
				? new Date(startsAt.getTime() + durationSeconds * 1000)
				: null,
			// Une expulsion prend effet et se termine dans la foulee : la laisser
			// ACTIVE la ferait apparaitre indefiniment comme sanction en cours.
			status: isInstant ? "EXPIRED" : "ACTIVE",
			// Meme bareme que cote API : une sanction posee depuis Discord doit
			// peser autant que la meme sanction posee depuis le dashboard.
			points: await pointsPourSanction(input.guildId, input.type),
		},
	});

	await prisma.moderationActivity.create({
		data: {
			guildId: input.guildId,
			moderatorId: input.moderatorId,
			action: `sanction.${input.type.toLowerCase()}`,
			targetUserId: input.userId,
			targetType: "sanction",
			targetId: sanction.id,
			metadata: { type: input.type, durationSeconds },
		},
	});

	return sanction;
}

/**
 * Revoque la sanction active la plus recente d'un type donne pour ce membre.
 *
 * `revokedById` reste `null` : cette colonne pointe vers `AppUser` (compte
 * dashboard), il n'existe pas d'equivalent pour un moderateur Discord. Le
 * moderateur reel est trace dans `ModerationActivity`, qui a bien un
 * `moderatorId` Discord.
 */
export async function revokeActiveSanction(
	guildId: string,
	userId: string,
	type: SanctionType,
	moderatorId: string,
	reason: string,
) {
	const existing = await prisma.sanction.findFirst({
		where: { guildId, userId, type, status: "ACTIVE" },
		orderBy: { createdAt: "desc" },
	});

	if (!existing) return null;

	const updated = await prisma.sanction.update({
		where: { id: existing.id },
		data: {
			status: "REVOKED",
			revokedAt: new Date(),
			revokeReason: reason,
			// L'effet Discord vient d'etre rejoue par l'appelant (timeout leve,
			// role retire) avant cet appel : pas besoin que la tache
			// periodique de synchronisation le refasse.
			discordSyncedAt: new Date(),
		},
	});

	await prisma.moderationActivity.create({
		data: {
			guildId,
			moderatorId,
			action: "sanction.revoke",
			targetUserId: userId,
			targetType: "sanction",
			targetId: existing.id,
			metadata: { type },
		},
	});

	return updated;
}

/**
 * Sanctions actives dont l'echeance est deja passee, pour un type donne.
 *
 * L'API bascule deja ces lignes en `EXPIRED` en base (cron cote NestJS), mais
 * ne touche a rien cote Discord. Pour un type dont l'effet est un role
 * (`SHADOWBAN`) plutot qu'un timeout natif, personne d'autre ne le retire :
 * le bot doit lire l'echeance lui-meme pour agir avant que l'API ne l'ait
 * deja marquee expiree.
 */
export async function findExpiredActiveSanctions(type: SanctionType) {
	return prisma.sanction.findMany({
		where: {
			type,
			status: "ACTIVE",
			expiresAt: { not: null, lte: new Date() },
		},
	});
}

/**
 * Sanctions encore actives dont l'effet côté Discord n'a pas encore été
 * ajouté par le bot — typiquement posées depuis la webapp.
 *
 * Volontairement sans condition sur `expiresAt` : une sanction permanente
 * (BAN sans durée, SHADOWBAN permanent) a `expiresAt = null` et doit quand
 * même être appliquée. Une condition `expiresAt > now()` ici les aurait
 * exclues indéfiniment — c'est ce qui empêchait un bannissement permanent ou
 * un shadowban permanent posé depuis la webapp de jamais atteindre Discord.
 */
export async function findActiveSanctions(types: SanctionType[]) {
	return prisma.sanction.findMany({
		where: {
			type: { in: types },
			status: "ACTIVE",
			isApplied: false,
		},
	});
}

/**
 * Sanctions instantanées (KICK) posées depuis la webapp, pas encore
 * répercutées côté Discord.
 *
 * Une sanction instantanée passe directement au statut `EXPIRED` a la
 * creation (l'action n'a pas de duree) : elle ne peut donc jamais remonter
 * via `findActiveSanctions`, qui filtre sur `status: "ACTIVE"`. Sans cette
 * requete dediee, une expulsion posee depuis la webapp n'expulsait jamais
 * personne sur Discord — elle etait juste marquee comme si de rien n'etait.
 */
export async function findUnappliedInstantSanctions(types: SanctionType[]) {
	return prisma.sanction.findMany({
		where: {
			type: { in: types },
			status: "EXPIRED",
			isApplied: false,
		},
	});
}

/**
 * Sanctions revoquees dont l'effet cote Discord n'a pas encore ete rejoue
 * par le bot.
 *
 * Une revocation faite depuis une commande bot (`/unmute`, `/unshadowban`)
 * agit sur Discord avant d'ecrire en base, et pose `discordSyncedAt` dans la
 * meme requete : elle ne remonte jamais ici. Seules les revocations faites
 * depuis `POST /sanctions/:id/revoke` (webapp), qui ne touche qu'a la base,
 * ont besoin de ce rattrapage.
 */
export async function findUnsyncedRevokedSanctions(types: SanctionType[]) {
	return prisma.sanction.findMany({
		where: {
			type: { in: types },
			status: "REVOKED",
			discordSyncedAt: null,
		},
	});
}

export async function markDiscordSynced(sanctionId: string) {
	await prisma.sanction.update({
		where: { id: sanctionId },
		data: { discordSyncedAt: new Date() },
	});
}

export async function markDiscordAppliedSanction(sanctionId: string) {
	await prisma.sanction.update({
		where: { id: sanctionId },
		data: { isApplied: true }
	})
}

export async function markSanctionExpired(
	sanctionId: string,
	guildId: string,
	userId: string,
	type: SanctionType,
) {
	await prisma.sanction.update({
		where: { id: sanctionId },
		data: { status: "EXPIRED" },
	});

	await prisma.moderationActivity.create({
		data: {
			guildId,
			action: "sanction.expire",
			targetUserId: userId,
			targetType: "sanction",
			targetId: sanctionId,
			metadata: { type },
		},
	});
}

interface CreateWarningInput {
	guildId: string;
	userId: string;
	moderatorId: string;
	reason: string;
	severity: WarningSeverity;
	points?: number;
}

export async function createWarning(input: CreateWarningInput) {
	// Resolu une fois : la ligne et le journal d'activite doivent porter le
	// meme poids, sans quoi les deux se contrediraient.
	const points =
		input.points ??
		(await pointsPourAvertissement(input.guildId, input.severity));

	const warning = await prisma.warning.create({
		data: {
			guildId: input.guildId,
			userId: input.userId,
			moderatorId: input.moderatorId,
			reason: input.reason,
			severity: input.severity,
			points,
			// `/warn` previent le membre juste apres : il n'y a rien a rattraper,
			// et laisser `null` ferait envoyer un second message prive par
			// `tasks/warningNotice.ts`.
			discordSyncedAt: new Date(),
		},
	});

	await prisma.moderationActivity.create({
		data: {
			guildId: input.guildId,
			moderatorId: input.moderatorId,
			action: "warn",
			targetUserId: input.userId,
			targetType: "warning",
			targetId: warning.id,
			metadata: { severity: input.severity, points },
		},
	});

	return warning;
}

// ---------------------------------------------------------------------------
// Sanctions posees hors du bot (client Discord, autre outil)
// ---------------------------------------------------------------------------

/**
 * Fenetre pendant laquelle une sanction identique est consideree comme la meme
 * action.
 *
 * Une commande du bot ecrit la sanction *avant* que Discord ne publie
 * l'evenement correspondant : sans ce garde, chaque `/ban` produirait deux
 * lignes, celle de la commande puis celle de l'ingestion.
 */
const FENETRE_DOUBLON_MS = 60_000;

interface ExternalSanctionInput {
	guildId: string;
	userId: string;
	/** Auteur reel releve dans l'audit log ; `null` s'il est inconnu. */
	moderatorId: string | null;
	type: SanctionType;
	reason: string;
	durationSeconds?: number | null;
	occurredAt?: Date;
}

async function sanctionDejaEnregistree(
	guildId: string,
	userId: string,
	type: SanctionType,
): Promise<boolean> {
	const recente = await prisma.sanction.findFirst({
		where: {
			guildId,
			userId,
			type,
			createdAt: { gte: new Date(Date.now() - FENETRE_DOUBLON_MS) },
		},
		select: { id: true },
	});

	return recente !== null;
}

/**
 * Enregistre une sanction appliquee directement sur Discord.
 *
 * `discordSyncedAt` est pose des la creation : l'effet est deja en place cote
 * Discord, la tache de synchronisation n'a rien a rejouer.
 *
 * Renvoie `null` si l'action avait deja ete enregistree — cas normal quand
 * elle vient d'une commande du bot.
 */
export async function recordExternalSanction(input: ExternalSanctionInput) {
	if (
		await sanctionDejaEnregistree(input.guildId, input.userId, input.type)
	) {
		return null;
	}

	const startsAt = input.occurredAt ?? new Date();
	const isInstant = INSTANT_SANCTION_TYPES.includes(input.type);
	const durationSeconds = isInstant ? null : (input.durationSeconds ?? null);

	const sanction = await prisma.sanction.create({
		data: {
			guildId: input.guildId,
			userId: input.userId,
			moderatorId: input.moderatorId,
			type: input.type,
			reason: input.reason,
			durationSeconds,
			startsAt,
			expiresAt: durationSeconds
				? new Date(startsAt.getTime() + durationSeconds * 1000)
				: null,
			status: isInstant ? "EXPIRED" : "ACTIVE",
			points: await pointsPourSanction(input.guildId, input.type),
			discordSyncedAt: new Date(),
		},
	});

	await prisma.moderationActivity.create({
		data: {
			guildId: input.guildId,
			moderatorId: input.moderatorId,
			action: `sanction.${input.type.toLowerCase()}`,
			targetUserId: input.userId,
			targetType: "sanction",
			targetId: sanction.id,
			metadata: { type: input.type, durationSeconds, source: "discord" },
		},
	});

	return sanction;
}

/**
 * Leve une sanction dont l'effet a ete retire directement sur Discord
 * (debannissement, exclusion temporaire annulee a la main).
 *
 * Renvoie `null` s'il n'y avait rien a lever : un debannissement peut viser
 * quelqu'un banni avant la mise en service du bot.
 */
export async function revokeExternalSanction(input: {
	guildId: string;
	userId: string;
	type: SanctionType;
	moderatorId: string | null;
	reason: string;
}) {
	const existante = await prisma.sanction.findFirst({
		where: {
			guildId: input.guildId,
			userId: input.userId,
			type: input.type,
			status: "ACTIVE",
		},
		orderBy: { createdAt: "desc" },
	});

	if (!existante) return null;

	const levee = await prisma.sanction.update({
		where: { id: existante.id },
		data: {
			status: "REVOKED",
			revokedAt: new Date(),
			revokeReason: input.reason,
			// L'effet a deja ete retire sur Discord par la personne qui a agi.
			discordSyncedAt: new Date(),
		},
	});

	await prisma.moderationActivity.create({
		data: {
			guildId: input.guildId,
			moderatorId: input.moderatorId,
			action: "sanction.revoke",
			targetUserId: input.userId,
			targetType: "sanction",
			targetId: existante.id,
			metadata: { type: input.type, source: "discord" },
		},
	});

	return levee;
}
