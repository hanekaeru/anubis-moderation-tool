import {
    INSTANT_SANCTION_TYPES,
    type SanctionType,
    type WarningSeverity,
} from '@anubis/shared';
import prisma from '../prisma';

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
            status: isInstant ? 'EXPIRED' : 'ACTIVE',
        },
    });

    await prisma.moderationActivity.create({
        data: {
            guildId: input.guildId,
            moderatorId: input.moderatorId,
            action: `sanction.${input.type.toLowerCase()}`,
            targetUserId: input.userId,
            targetType: 'sanction',
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
        where: { guildId, userId, type, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
    });

    if (!existing) return null;

    const updated = await prisma.sanction.update({
        where: { id: existing.id },
        data: {
            status: 'REVOKED',
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
            action: 'sanction.revoke',
            targetUserId: userId,
            targetType: 'sanction',
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
        where: { type, status: 'ACTIVE', expiresAt: { not: null, lte: new Date() } },
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
        where: { type: { in: types }, status: 'REVOKED', discordSyncedAt: null },
    });
}

export async function markDiscordSynced(sanctionId: string) {
    await prisma.sanction.update({
        where: { id: sanctionId },
        data: { discordSyncedAt: new Date() },
    });
}

export async function markSanctionExpired(sanctionId: string, guildId: string, userId: string, type: SanctionType) {
    await prisma.sanction.update({
        where: { id: sanctionId },
        data: { status: 'EXPIRED' },
    });

    await prisma.moderationActivity.create({
        data: {
            guildId,
            action: 'sanction.expire',
            targetUserId: userId,
            targetType: 'sanction',
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
    const warning = await prisma.warning.create({
        data: {
            guildId: input.guildId,
            userId: input.userId,
            moderatorId: input.moderatorId,
            reason: input.reason,
            severity: input.severity,
            points: input.points ?? 1,
        },
    });

    await prisma.moderationActivity.create({
        data: {
            guildId: input.guildId,
            moderatorId: input.moderatorId,
            action: 'warn',
            targetUserId: input.userId,
            targetType: 'warning',
            targetId: warning.id,
            metadata: { severity: input.severity, points: input.points ?? 1 },
        },
    });

    return warning;
}
