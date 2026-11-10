import type { Guild } from "discord.js";
import prisma from "../prisma";

/**
 * Role « BattleTag verifie » : il suit les liens actifs, et rien d'autre.
 *
 * Le lien fait foi. Le role est donc reconcilie en continu plutot que pose au
 * moment de la verification : un seul endroit decide, pour tous les chemins —
 * bouton du reglement, `/lier_battlenet`, deliaison depuis Discord ou le
 * dashboard, retour d'un membre, expiration d'un lien. Un role pose a la main
 * sans lien est retire au passage suivant, un role retire a un membre lie lui
 * est rendu : sinon le role ne prouverait plus rien.
 *
 * Deux exceptions :
 * - un membre **shadowbanne** n'est jamais touche. Le shadowban a mis ses roles
 *   de cote expres (`shadowbanRole.ts`) : en rendre un pourrait lever la
 *   restriction, et la restitution le lui rendra de toute facon.
 * - un role que le bot ne peut pas gerer (supprime, gere par une integration,
 *   place au-dessus du sien) suspend la reconciliation, avec un avertissement
 *   une seule fois — le passage revient toutes les cinq secondes.
 */

const rolesSignales = new Set<string>();
const enCours = new Set<string>();

export async function reconcilierRoleBattlenet(guild: Guild): Promise<void> {
	// Un passage lent (beaucoup de roles a poser au premier reglage) ne doit pas
	// en voir un second demarrer par-dessus.
	if (enCours.has(guild.id)) return;
	enCours.add(guild.id);

	try {
		await reconcilier(guild);
	} finally {
		enCours.delete(guild.id);
	}
}

async function reconcilier(guild: Guild): Promise<void> {
	const config = await prisma.quarantineConfig.findUnique({
		where: { guildId: guild.id },
		select: { battlenetRoleId: true },
	});
	const roleId = config?.battlenetRoleId;
	if (!roleId) return;

	const role = guild.roles.cache.get(roleId);
	const botHighest = guild.members.me?.roles.highest;
	if (
		!role ||
		role.managed ||
		role.id === guild.id ||
		!botHighest ||
		role.comparePositionTo(botHighest) >= 0
	) {
		if (!rolesSignales.has(roleId)) {
			rolesSignales.add(roleId);
			console.warn(
				`[Battle.net] Rôle « BattleTag vérifié » ${roleId} introuvable ou hors de portée du bot ` +
					"(géré par une intégration, ou placé au-dessus du rôle du bot) : il n'est plus synchronisé.",
			);
		}
		return;
	}
	rolesSignales.delete(roleId);

	const [liens, shadowbans] = await Promise.all([
		prisma.battlenetAccount.findMany({
			where: { unlinkedAt: null },
			select: { userId: true },
		}),
		prisma.shadowbanRoleBackup.findMany({
			where: { guildId: guild.id },
			select: { userId: true },
		}),
	]);
	const lies = new Set(liens.map((lien) => lien.userId));
	const intouchables = new Set(shadowbans.map((backup) => backup.userId));

	for (const member of role.members.values()) {
		if (lies.has(member.id) || intouchables.has(member.id)) continue;
		await member.roles
			.remove(role, "Aucun compte Battle.net lié.")
			.catch((err) => console.error(`[Battle.net] Rôle non retiré à ${member.id} :`, err));
	}

	for (const userId of lies) {
		if (intouchables.has(userId)) continue;
		const member = guild.members.cache.get(userId);
		if (!member || member.roles.cache.has(roleId)) continue;
		await member.roles
			.add(role, "Compte Battle.net lié.")
			.catch((err) => console.error(`[Battle.net] Rôle non attribué à ${userId} :`, err));
	}
}
