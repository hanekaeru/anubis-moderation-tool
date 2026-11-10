import {
	moderationPointsFromRow,
	type ModerationPoints,
	type SanctionType,
	type WarningSeverity,
} from "@anubis/shared";
import prisma from "../prisma";

/**
 * Bareme de points, cote bot.
 *
 * Lecture seule, par la meme traduction que l'API (`moderationPointsFromRow`,
 * `@anubis/shared`) : le bot ne regle jamais le bareme, il le consulte pour donner son poids a une
 * sanction ou a un avertissement pose depuis Discord. Sans cela, une sanction
 * venue de Discord retomberait sur la valeur par defaut de la colonne et
 * compterait autrement que la meme sanction posee depuis le dashboard.
 *
 * Le cache evite une requete par sanction ; sa duree est celle de
 * l'automodification (`automod.ts`), pour la meme raison : un bareme change
 * depuis le dashboard doit s'appliquer vite, sans pour autant faire un aller
 * en base a chaque message.
 */
const TTL_CACHE_MS = 30_000;

const cache = new Map<string, { valeur: ModerationPoints; expireA: number }>();

async function lireBareme(guildId: string): Promise<ModerationPoints> {
	const enCache = cache.get(guildId);
	if (enCache && enCache.expireA > Date.now()) return enCache.valeur;

	const row = await prisma.moderationPointsConfig.findUnique({
		where: { guildId },
	});

	// La meme lecture que l'API : une sanction posee depuis Discord doit peser
	// autant que la meme sanction posee depuis le dashboard.
	const valeur = moderationPointsFromRow(row);

	cache.set(guildId, { valeur, expireA: Date.now() + TTL_CACHE_MS });
	return valeur;
}

export async function pointsPourSanction(
	guildId: string,
	type: SanctionType,
): Promise<number> {
	return (await lireBareme(guildId)).sanctionPoints[type];
}

export async function pointsPourAvertissement(
	guildId: string,
	severity: WarningSeverity,
): Promise<number> {
	return (await lireBareme(guildId)).warningPoints[severity];
}

/** Vide le cache — utile aux tests, et apres un reglage connu du bot. */
export function viderCacheBareme(): void {
	cache.clear();
}
