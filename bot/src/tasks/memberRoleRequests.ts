import type { Client, Guild } from "discord.js";
import prisma from "../prisma";

/**
 * Applique les roles separateurs demandes depuis la fiche membre du dashboard.
 *
 * L'API n'a aucun acces a Discord : elle depose une ligne `member_role_requests`
 * avec `discordSyncedAt` a `null`, ce passage l'applique. Meme patron que
 * `warningNotice.ts`.
 *
 * Le bot **revalide** chaque role plutot que de faire confiance a la demande :
 * un role a pu cesser d'etre separateur, etre supprime ou passer au-dessus du
 * bot entre le clic et l'application. Ce qui ne peut pas etre pose est ecarte,
 * le reste est pose quand meme — refuser tout le lot pour un seul role
 * laisserait le moderateur sans rien, sans comprendre pourquoi.
 *
 * La date est posee **meme en cas d'echec**, avec `lastError` : sans cela une
 * demande refusee par Discord reviendrait toutes les cinq secondes.
 */
export async function appliquerDemandesDeRoles(client: Client): Promise<void> {
	const pending = await prisma.memberRoleRequest.findMany({
		where: { discordSyncedAt: null },
		include: { requestedBy: { select: { displayName: true } } },
		orderBy: { createdAt: "asc" },
		take: 25,
	});

	for (const demande of pending) {
		const guild = client.guilds.cache.get(demande.guildId);
		// Serveur hors de portee de cette instance : la ligne attend.
		if (!guild) continue;

		let lastError: string | null;
		try {
			lastError = await appliquer(guild, demande);
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
			console.error(`[Rôles] Séparateurs de ${demande.userId} non ajoutés :`, err);
		}

		await prisma.memberRoleRequest.update({
			where: { id: demande.id },
			data: { discordSyncedAt: new Date(), lastError },
		});
	}
}

async function appliquer(
	guild: Guild,
	demande: {
		userId: string;
		roleIds: string[];
		requestedBy: { displayName: string } | null;
	},
): Promise<string | null> {
	const member = await guild.members.fetch(demande.userId).catch(() => null);
	if (!member) return "Membre introuvable sur le serveur.";

	const separateurs = await prisma.role.findMany({
		where: {
			guildId: guild.id,
			id: { in: demande.roleIds },
			isSeparator: true,
			deletedAt: null,
		},
		select: { id: true },
	});
	const valides = new Set(separateurs.map((role) => role.id));

	const botHighest = guild.members.me?.roles.highest ?? null;
	const aPoser: string[] = [];
	const ecartes: string[] = [];

	for (const roleId of demande.roleIds) {
		if (member.roles.cache.has(roleId)) continue;

		const role = guild.roles.cache.get(roleId);
		const attribuable =
			valides.has(roleId) &&
			role !== undefined &&
			!role.managed &&
			botHighest !== null &&
			role.comparePositionTo(botHighest) < 0;

		if (attribuable) aPoser.push(roleId);
		else ecartes.push(roleId);
	}

	if (aPoser.length) {
		const auteur = demande.requestedBy?.displayName ?? "le dashboard";
		await member.roles.add(aPoser, `Séparateurs ajoutés depuis le dashboard par ${auteur}.`);
	}

	if (!ecartes.length) return null;

	console.warn(
		`[Rôles] Séparateurs non attribuables à ${member.id} (plus séparateurs, supprimés ou au-dessus du bot) : ` +
			ecartes.join(", "),
	);
	return `Rôles non attribuables : ${ecartes.join(", ")}.`;
}
