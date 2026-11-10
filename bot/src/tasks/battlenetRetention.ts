import {
	BATTLENET_BATTLETAG_RETENTION_DAYS,
	battlenetLinkExpired,
	MemberStatus,
} from "@anubis/shared";
import prisma from "../prisma";

/**
 * Purge des donnees Battle.net arrivees au terme de leur conservation.
 *
 * Les durees et la regle vivent dans `@anubis/shared` (`battlenet.ts`), ou
 * elles sont testees ; ce fichier ne fait que rassembler les faits et
 * supprimer. Trois choses s'effacent :
 *
 * - le **BattleTag**, 30 jours apres la verification ;
 * - les **liens** des membres partis, 12 mois apres le depart ;
 * - les **traces** de deliaison, 12 mois apres la deliaison.
 *
 * Un bannissement en cours suspend tout, et ses 12 mois partent de sa fin : un
 * banni est precisement celui qui revient sur un compte secondaire.
 *
 * Un membre sans ligne `members` est garde : sans date de depart, rien ne dit
 * que la conservation a commence.
 */
export async function purgerBattlenet(maintenant: Date = new Date()): Promise<void> {
	const limiteBattletag = new Date(
		maintenant.getTime() - BATTLENET_BATTLETAG_RETENTION_DAYS * 86_400_000,
	);

	const battletags = await prisma.battlenetAccount.updateMany({
		where: { battletag: { not: null }, verifiedAt: { lte: limiteBattletag } },
		data: { battletag: null },
	});

	const lignes = await prisma.battlenetAccount.findMany({
		select: { battlenetHash: true, userId: true, guildId: true, unlinkedAt: true },
	});

	let supprimes = 0;
	for (const ligne of lignes) {
		const [membre, bans] = await Promise.all([
			prisma.member.findUnique({
				where: { guildId_userId: { guildId: ligne.guildId, userId: ligne.userId } },
				select: { status: true, leftAt: true },
			}),
			prisma.sanction.findMany({
				where: { guildId: ligne.guildId, userId: ligne.userId, type: "BAN" },
				select: { status: true, expiresAt: true, revokedAt: true, createdAt: true },
			}),
		]);

		const parti = membre !== null && membre.status !== MemberStatus.ACTIVE;
		const finsDeBan = bans
			.filter((ban) => ban.status !== "ACTIVE")
			.map((ban) => (ban.revokedAt ?? ban.expiresAt ?? ban.createdAt).getTime());

		const expire = battlenetLinkExpired(
			{
				unlinkedAt: ligne.unlinkedAt,
				leftAt: parti ? (membre.leftAt ?? null) : null,
				banActive: bans.some((ban) => ban.status === "ACTIVE"),
				banEndedAt: finsDeBan.length > 0 ? new Date(Math.max(...finsDeBan)) : null,
			},
			maintenant,
		);

		if (!expire) continue;

		await prisma.battlenetAccount.delete({
			where: { battlenetHash: ligne.battlenetHash },
		});
		supprimes++;
	}

	if (battletags.count > 0 || supprimes > 0) {
		console.log(
			`[Battle.net] Conservation : ${battletags.count} BattleTag(s) effacé(s), ` +
				`${supprimes} lien(s) ou trace(s) supprimé(s).`,
		);
	}
}
