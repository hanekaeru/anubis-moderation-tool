import type { EmbedBuilder, Guild, User } from "discord.js";
import { QuarantineStage, quarantineStage } from "@anubis/shared";
import type { AccountFlagType, IdentityEventType, MemberStatus, SanctionType } from "@anubis/shared/prisma";
import prisma from "../prisma";
import { embedBase, embedDiscord } from "../utils/whoisEmbeds";
import xpManager from "./xp";

/**
 * Fiche complete d'un compte : ce que Discord en dit, puis ce que la base en a
 * retenu. Partagee par `/whois` et par les boutons des signalements, qui
 * doivent montrer exactement la meme chose.
 */
export async function ficheWhois(guild: Guild, user: User): Promise<EmbedBuilder[]> {
	const [member, ban, dossier] = await Promise.all([
		guild.members.fetch(user.id).catch(() => null),
		// Exige « Bannir des membres » cote bot : sans elle, on ne dit rien
		// plutot que d'echouer — le statut en base le dira de toute facon.
		guild.bans.fetch(user.id).catch(() => null),
		lireDossier(guild.id, user.id),
	]);
	return [embedDiscord(user, member, ban), embedBase(dossier)];
}

/**
 * Tout ce que la base sait d'un compte, pour `/whois`.
 *
 * Lu sans le membre Discord : c'est ce qui fait fonctionner la commande pour
 * quelqu'un qui a quitte le serveur.
 */

/** Plafonds d'affichage : un champ d'embed ne tient que 1024 caracteres. */
const HISTORIQUE_IDENTITE = 8;
const SANCTIONS_ACTIVES = 5;
const SIGNALEMENTS = 5;

/** Fenetre du « recemment » des statistiques de messages. */
const JOURS_RECENTS = 30;

export interface DossierWhois {
	connu: boolean;
	user: {
		username: string;
		globalName: string | null;
		avatarUrl: string | null;
		accountCreatedAt: Date | null;
		firstSeenAt: Date;
	} | null;
	member: {
		nickname: string | null;
		status: MemberStatus;
		joinedAt: Date | null;
		leftAt: Date | null;
		joinCount: number;
		boostingSince: Date | null;
	} | null;
	identite: {
		type: IdentityEventType;
		oldValue: string | null;
		newValue: string | null;
		occurredAt: Date;
	}[];
	xp: { xp: number; level: number; rank: number };
	messages: { total: number; recents: number; dernierJour: Date | null };
	moderation: {
		avertissementsActifs: number;
		avertissementsTotal: number;
		sanctionsActives: { type: SanctionType; expiresAt: Date | null; reason: string }[];
		sanctionsActivesTotal: number;
		sanctionsTotal: number;
	};
	quarantaine: { stage: QuarantineStage; quarantinedAt: Date } | null;
	/**
	 * Lien actif seulement, sans BattleTag : celui-ci est reserve a
	 * `battlenet:read` (administrateurs) dans le dashboard, et la reponse de
	 * `/whois` est lue par tout moderateur.
	 */
	battlenetVerifieLe: Date | null;
	signalements: {
		total: number;
		derniers: { type: AccountFlagType; createdAt: Date; reviewed: boolean }[];
	};
}

export async function lireDossier(guildId: string, userId: string): Promise<DossierWhois> {
	const maintenant = new Date();
	const depuis = new Date(maintenant.getTime() - JOURS_RECENTS * 86_400_000);

	const [
		user,
		member,
		identite,
		progress,
		rank,
		messagesTotal,
		messagesRecents,
		avertissementsActifs,
		avertissementsTotal,
		sanctionsActives,
		sanctionsActivesTotal,
		sanctionsTotal,
		quarantaine,
		quarantaineConfig,
		battlenet,
		signalements,
		signalementsTotal,
	] = await Promise.all([
		prisma.discordUser.findUnique({
			where: { id: userId },
			select: {
				username: true,
				globalName: true,
				avatarUrl: true,
				accountCreatedAt: true,
				firstSeenAt: true,
			},
		}),
		prisma.member.findUnique({
			where: { guildId_userId: { guildId, userId } },
			select: {
				nickname: true,
				status: true,
				joinedAt: true,
				leftAt: true,
				joinCount: true,
				boostingSince: true,
			},
		}),
		// Les changements de pseudo et de nom global n'ont pas de serveur
		// (`guildId` null) ; un surnom n'a de sens que sur le sien.
		prisma.identityEvent.findMany({
			where: {
				userId,
				type: { not: "AVATAR_CHANGED" },
				OR: [{ guildId: null }, { guildId }],
			},
			orderBy: { occurredAt: "desc" },
			take: HISTORIQUE_IDENTITE,
			select: { type: true, oldValue: true, newValue: true, occurredAt: true },
		}),
		// L'instance partagee, pas une lecture directe de `user_levels` : l'XP
		// encore en attente dans le buffer doit compter, comme pour `/rank`.
		xpManager.getProgress(userId, guildId),
		xpManager.getRank(userId, guildId),
		prisma.messageStat.aggregate({
			where: { guildId, userId },
			_sum: { messageCount: true },
			_max: { day: true },
		}),
		prisma.messageStat.aggregate({
			where: { guildId, userId, day: { gte: depuis } },
			_sum: { messageCount: true },
		}),
		// Memes predicats que `MembersService` cote API : la fiche du dashboard
		// et `/whois` doivent compter le meme « actif ».
		prisma.warning.count({
			where: {
				guildId,
				userId,
				revokedAt: null,
				OR: [{ expiresAt: null }, { expiresAt: { gt: maintenant } }],
			},
		}),
		prisma.warning.count({ where: { guildId, userId } }),
		prisma.sanction.findMany({
			where: { guildId, userId, status: "ACTIVE" },
			orderBy: { createdAt: "desc" },
			take: SANCTIONS_ACTIVES,
			select: { type: true, expiresAt: true, reason: true },
		}),
		prisma.sanction.count({ where: { guildId, userId, status: "ACTIVE" } }),
		prisma.sanction.count({ where: { guildId, userId } }),
		prisma.quarantineStatus.findUnique({
			where: { guildId_userId: { guildId, userId } },
			select: {
				quarantinedAt: true,
				acceptedAt: true,
				battlenetVerifiedAt: true,
				releasedAt: true,
			},
		}),
		prisma.quarantineConfig.findUnique({
			where: { guildId },
			select: { battlenetRequired: true },
		}),
		// `select` explicite : le BattleTag ne doit pas meme transiter.
		prisma.battlenetAccount.findFirst({
			where: { userId, unlinkedAt: null },
			orderBy: { verifiedAt: "desc" },
			select: { verifiedAt: true },
		}),
		prisma.accountFlag.findMany({
			where: { guildId, userId },
			orderBy: { createdAt: "desc" },
			take: SIGNALEMENTS,
			select: { type: true, createdAt: true, reviewedAt: true },
		}),
		prisma.accountFlag.count({ where: { guildId, userId } }),
	]);

	return {
		connu: user !== null,
		user,
		member,
		identite,
		xp: { xp: progress.xp, level: progress.level, rank },
		messages: {
			total: messagesTotal._sum.messageCount ?? 0,
			recents: messagesRecents._sum.messageCount ?? 0,
			dernierJour: messagesTotal._max.day ?? null,
		},
		moderation: {
			avertissementsActifs,
			avertissementsTotal,
			sanctionsActives,
			sanctionsActivesTotal,
			sanctionsTotal,
		},
		quarantaine: quarantaine
			? {
					// Meme arbitre que le bot et le dashboard : `/whois` ne doit pas
					// annoncer « libere » un membre que la liste montre bloque.
					stage: quarantineStage(quarantaine, quarantaineConfig?.battlenetRequired ?? false),
					quarantinedAt: quarantaine.quarantinedAt,
				}
			: null,
		battlenetVerifieLe: battlenet?.verifiedAt ?? null,
		signalements: {
			total: signalementsTotal,
			derniers: signalements.map((s) => ({
				type: s.type,
				createdAt: s.createdAt,
				reviewed: s.reviewedAt !== null,
			})),
		},
	};
}
