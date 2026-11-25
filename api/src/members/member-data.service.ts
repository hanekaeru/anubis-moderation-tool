import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { MemberErasureResult } from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";

/** Nom pose sur un compte garde pour ses seules traces (bannissement, Battle.net). */
export const ERASED_USERNAME = "compte-efface";

/**
 * Export et effacement des donnees d'un membre, a sa demande (RGPD).
 *
 * **Une seule liste fait foi : les relations de `DiscordUser` dans le schema.**
 * Chaque table qui porte un membre y figure ; en ajouter une sans la reporter
 * ici la laisserait hors de l'export et survivre a l'effacement. Les tables sans
 * cle etrangere (`user_levels`, `xp_adjustments`) sont traitees a part, pour la
 * meme raison.
 *
 * Le dashboard ne gere qu'un serveur : tout se lit et s'efface par
 * `userId`, sans filtre de serveur.
 */
@Injectable()
export class MemberDataService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly audit: AuditService,
	) {}

	/**
	 * Tout ce que la base tient sur ce compte, en JSON. Les octets des pieces
	 * jointes de ticket ne sont pas inclus (nom, type et taille seulement) :
	 * l'export doit rester un fichier qu'on peut envoyer par message.
	 *
	 * **Les notes du staff n'y figurent pas**, par decision du proprietaire :
	 * ce sont des aide-memoire internes, au meme titre qu'un identifiant note
	 * dans un bloc-notes. L'effacement, lui, les supprime bien.
	 */
	async export(userId: string, actor: AuthenticatedUser): Promise<Record<string, unknown>> {
		const p = this.prisma;
		const user = await p.discordUser.findUnique({ where: { id: userId } });
		if (!user) throw new NotFoundException("Ce compte est inconnu de la base.");

		const parUtilisateur = { where: { userId } };
		const [
			memberships,
			roles,
			roleEvents,
			identityEvents,
			warnings,
			sanctions,
			tickets,
			automodIncidents,
			accountFlags,
			quarantine,
			roleRequests,
			battlenet,
			messageStats,
			activityProfile,
			voiceSessions,
			xp,
			xpAdjustments,
			giveawayEntries,
			owdleGames,
			owdleWeeklyBonuses,
			minigameGames,
		] = await Promise.all([
			p.member.findMany(parUtilisateur),
			p.memberRole.findMany({ ...parUtilisateur, include: { role: { select: { name: true } } } }),
			p.memberRoleEvent.findMany({ ...parUtilisateur, include: { role: { select: { name: true } } } }),
			p.identityEvent.findMany(parUtilisateur),
			p.warning.findMany(parUtilisateur),
			p.sanction.findMany(parUtilisateur),
			p.ticket.findMany({
				where: { openerId: userId },
				include: {
					events: true,
					attachments: { select: { id: true, fileName: true, contentType: true, size: true, createdAt: true } },
				},
			}),
			p.automodIncident.findMany(parUtilisateur),
			p.accountFlag.findMany(parUtilisateur),
			p.quarantineStatus.findMany(parUtilisateur),
			p.memberRoleRequest.findMany(parUtilisateur),
			// L'empreinte n'apprend rien a la personne et ne sert qu'a l'unicite.
			p.battlenetAccount.findMany({
				...parUtilisateur,
				select: { battletag: true, verifiedAt: true, unlinkedAt: true, guildId: true },
			}),
			p.messageStat.findMany(parUtilisateur),
			p.memberActivityProfile.findMany(parUtilisateur),
			p.voiceSession.findMany(parUtilisateur),
			p.userLevel.findMany(parUtilisateur),
			p.xpAdjustment.findMany(parUtilisateur),
			p.giveawayEntry.findMany(parUtilisateur),
			p.owdleGame.findMany(parUtilisateur),
			p.owdleWeeklyBonus.findMany(parUtilisateur),
			p.minigameGame.findMany(parUtilisateur),
		]);

		await this.audit.record({
			appUserId: actor.id,
			action: "member.data.export",
			entityType: "discord_user",
			entityId: userId,
		});

		return enJson({
			exportedAt: new Date(),
			user,
			memberships,
			roles,
			roleEvents,
			identityEvents,
			warnings,
			sanctions,
			tickets,
			automodIncidents,
			accountFlags,
			quarantine,
			roleRequests,
			battlenet,
			messageStats,
			activityProfile,
			voiceSessions,
			xp,
			xpAdjustments,
			giveawayEntries,
			owdleGames,
			owdleWeeklyBonuses,
			minigameGames,
		});
	}

	/**
	 * Efface tout, sauf les bannissements et l'empreinte Battle.net (BattleTag
	 * retire). Une seule transaction : un effacement a moitie fait serait le
	 * pire des deux mondes — ni conserve proprement, ni efface.
	 *
	 * Le compte Discord est **supprime** si plus rien ne le retient, sinon
	 * **anonymise** : les lignes gardees ont besoin de son identifiant. Le
	 * journal d'audit ne retient que l'identifiant et les compteurs, jamais ce
	 * qui a ete efface.
	 *
	 * Si la personne est encore sur le serveur, le bot recommencera a noter son
	 * activite a partir de maintenant : l'effacement porte sur le passe.
	 */
	async erase(userId: string, confirmation: string, actor: AuthenticatedUser): Promise<MemberErasureResult> {
		if (confirmation.trim() !== userId) {
			throw new BadRequestException("Retapez l'identifiant du membre pour confirmer l'effacement.");
		}
		const user = await this.prisma.discordUser.findUnique({ where: { id: userId }, select: { id: true } });
		if (!user) throw new NotFoundException("Ce compte est inconnu de la base.");

		const resultat = await this.prisma.$transaction(async (tx) => {
			const bans = await tx.sanction.findMany({
				where: { userId, type: "BAN" },
				select: { id: true, automodIncidentId: true },
			});
			// L'incident qui a motive un bannissement garde reste avec lui : c'est
			// la preuve de ce qui a ete reproche.
			const incidentsGardes = bans
				.map((ban) => ban.automodIncidentId)
				.filter((id): id is bigint => id !== null);
			const battlenet = await tx.battlenetAccount.updateMany({ where: { userId }, data: { battletag: null } });

			const parUtilisateur = { where: { userId } };
			const deleted: Record<string, number> = {
				avertissements: (await tx.warning.deleteMany(parUtilisateur)).count,
				sanctions: (await tx.sanction.deleteMany({ where: { userId, type: { not: "BAN" } } })).count,
				notes: (await tx.memberNote.deleteMany(parUtilisateur)).count,
				tickets: (await tx.ticket.deleteMany({ where: { openerId: userId } })).count,
				incidentsAutomod: (
					await tx.automodIncident.deleteMany({ where: { userId, id: { notIn: incidentsGardes } } })
				).count,
				signalements: (await tx.accountFlag.deleteMany(parUtilisateur)).count,
				quarantaine: (await tx.quarantineStatus.deleteMany(parUtilisateur)).count,
				historiqueNoms: (await tx.identityEvent.deleteMany(parUtilisateur)).count,
				roles: (await tx.memberRole.deleteMany(parUtilisateur)).count,
				mouvementsRoles: (await tx.memberRoleEvent.deleteMany(parUtilisateur)).count,
				demandesRoles: (await tx.memberRoleRequest.deleteMany(parUtilisateur)).count,
				sauvegardesShadowban: (await tx.shadowbanRoleBackup.deleteMany(parUtilisateur)).count,
				verificationsBattlenet: (await tx.battlenetVerificationState.deleteMany(parUtilisateur)).count,
				statistiquesMessages: (await tx.messageStat.deleteMany(parUtilisateur)).count,
				profilActivite: (await tx.memberActivityProfile.deleteMany(parUtilisateur)).count,
				sessionsVocales: (await tx.voiceSession.deleteMany(parUtilisateur)).count,
				experience: (await tx.userLevel.deleteMany(parUtilisateur)).count,
				ajustementsXp: (await tx.xpAdjustment.deleteMany(parUtilisateur)).count,
				concours: (await tx.giveawayEntry.deleteMany(parUtilisateur)).count,
				rappels: (await tx.staffReminder.deleteMany(parUtilisateur)).count,
				prefixesTicket: (await tx.ticketModeratorPrefix.deleteMany(parUtilisateur)).count,
				owdle: (await tx.owdleGame.deleteMany(parUtilisateur)).count,
				bonusOwdle: (await tx.owdleWeeklyBonus.deleteMany(parUtilisateur)).count,
				miniJeux: (await tx.minigameGame.deleteMany(parUtilisateur)).count,
			};
			// Journal de moderation : la ligne reste pour le moderateur qui l'a
			// faite, elle cesse de designer le membre.
			await tx.moderationActivity.updateMany({ where: { targetUserId: userId }, data: { targetUserId: null } });

			const garde = bans.length > 0 || battlenet.count > 0;
			if (garde) {
				// Un banni garde sa ligne de presence : c'est elle qui dit « BANNED »
				// au bot et a la surveillance d'arrivee. Le surnom part.
				if (bans.length) {
					await tx.member.updateMany({ where: { userId }, data: { nickname: null } });
				} else {
					deleted.presence = (await tx.member.deleteMany(parUtilisateur)).count;
				}
				await tx.discordUser.update({
					where: { id: userId },
					data: {
						username: ERASED_USERNAME,
						globalName: null,
						discriminator: null,
						avatarUrl: null,
					},
				});
			} else {
				deleted.presence = (await tx.member.deleteMany(parUtilisateur)).count;
				// Les relations restantes ne designent ce compte que comme auteur
				// (moderateur d'une sanction, preneur d'un ticket) : `SetNull`.
				await tx.discordUser.delete({ where: { id: userId } });
			}

			return {
				deleted,
				kept: { bans: bans.length, battlenetLinks: battlenet.count },
				userRemoved: !garde,
			};
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "member.data.erase",
			entityType: "discord_user",
			entityId: userId,
			after: { ...resultat.deleted, keptBans: resultat.kept.bans, keptBattlenet: resultat.kept.battlenetLinks },
		});

		return resultat;
	}
}

/** Dates en ISO, `BigInt` en texte : un export doit se relire tel quel. */
function enJson(valeur: unknown): Record<string, unknown> {
	return JSON.parse(
		JSON.stringify(valeur, (_cle, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
	) as Record<string, unknown>;
}
