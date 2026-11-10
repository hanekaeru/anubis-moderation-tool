import { Injectable, NotFoundException } from "@nestjs/common";
import { Permission, type BattlenetLinkDto } from "@anubis/shared";
import { unlinkBattlenet } from "@anubis/shared/server";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import { toActorLabel } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Lien Battle.net d'un membre, vu et delie depuis la fiche membre.
 *
 * La deliaison elle-meme vit dans `@anubis/shared/server` (`unlinkBattlenet`),
 * partagee avec `/delier_battlenet` et `/delier_battlenet_admin` : les deux
 * chemins doivent laisser la meme trace et faire reculer la quarantaine de la
 * meme facon.
 */
@Injectable()
export class BattlenetLinksService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	async get(userId: string, actor: AuthenticatedUser): Promise<BattlenetLinkDto> {
		const lignes = await this.prisma.battlenetAccount.findMany({
			where: { userId },
			include: { unlinkedBy: true, unlinkedByDiscord: true },
			orderBy: { verifiedAt: "desc" },
		});

		const actif = lignes.find((ligne) => ligne.unlinkedAt === null);
		// La trace la plus recente : c'est elle qui dit ce qui s'est passe en
		// dernier, les plus anciennes ne servent qu'a bloquer leurs comptes.
		const trace = lignes
			.filter((ligne) => ligne.unlinkedAt !== null)
			.sort((a, b) => b.unlinkedAt!.getTime() - a.unlinkedAt!.getTime())[0];

		if (actif) {
			return {
				userId,
				state: "LINKED",
				verifiedAt: actif.verifiedAt.toISOString(),
				battletag: actor.permissions.includes(Permission.BATTLENET_READ)
					? actif.battletag
					: null,
				unlinkedAt: null,
				unlinkedBy: null,
			};
		}

		if (trace) {
			return {
				userId,
				state: "UNLINKED",
				verifiedAt: trace.verifiedAt.toISOString(),
				battletag: null,
				unlinkedAt: trace.unlinkedAt!.toISOString(),
				unlinkedBy: toActorLabel(trace.unlinkedByDiscord, trace.unlinkedBy),
			};
		}

		return {
			userId,
			state: "NONE",
			verifiedAt: null,
			battletag: null,
			unlinkedAt: null,
			unlinkedBy: null,
		};
	}

	/**
	 * Deliaison par un administrateur. Avec `release`, la trace part aussi et
	 * rien n'est annonce sur Discord — il ne reste aucune ligne a ramasser : le
	 * journal d'audit en garde la trace.
	 */
	async unlink(
		userId: string,
		release: boolean,
		actor: AuthenticatedUser,
	): Promise<BattlenetLinkDto> {
		const resultat = await unlinkBattlenet(this.prisma, {
			guildId: this.guild.guildId,
			userId,
			author: { appUserId: actor.id },
			release,
		});

		if (resultat === "aucun-lien") {
			throw new NotFoundException(
				release
					? "Aucun compte Battle.net lié ni délié pour ce membre."
					: "Aucun compte Battle.net lié pour ce membre.",
			);
		}

		await this.audit.record({
			appUserId: actor.id,
			action: release ? "battlenet.release" : "battlenet.unlink",
			entityType: "battlenet_account",
			entityId: userId,
		});

		return this.get(userId, actor);
	}
}
