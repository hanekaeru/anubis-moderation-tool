import { AuditLogEvent, Events } from 'discord.js';
import { MemberStatus, SanctionType } from '@anubis/shared';
import type { BotEvent } from '../src/types';
import prisma from '../src/prisma';
import * as referentiel from '../src/collectors/referentiel';
import * as moderation from '../src/collectors/moderation';
import { chercherAction, garantirAuteur } from '../src/collectors/discordAudit';

const event: BotEvent<typeof Events.GuildBanRemove> = {
    name: Events.GuildBanRemove,
    once: false,
    async execute(ban, client) {
        const { guild, user } = ban;

        try {
            await referentiel.upsertUser(user);

            // Debanni mais toujours absent du serveur : le statut redevient
            // "parti", pas "present".
            await prisma.member.updateMany({
                where: { guildId: guild.id, userId: user.id },
                data: { status: MemberStatus.LEFT },
            });

            const action = await chercherAction(guild, AuditLogEvent.MemberBanRemove, user.id);

            if (action?.executorId && action.executorId === client.user?.id) {
                console.log(`[Moderation] Debannissement de ${user.tag} deja enregistre par la commande.`);
                return;
            }

            const moderatorId = await garantirAuteur(client, action?.executorId ?? null);

            const levee = await moderation.revokeExternalSanction({
                guildId: guild.id,
                userId: user.id,
                type: SanctionType.BAN,
                moderatorId,
                reason: action?.reason ?? 'Debannissement depuis Discord.',
            });

            console.log(
                levee
                    ? `[Moderation] Bannissement de ${user.tag} leve (auteur : ${action?.executorTag ?? 'inconnu'}).`
                    // Cas normal pour un bannissement anterieur a la mise en
                    // service du bot : il n'y a aucune sanction a lever.
                    : `[Moderation] Debannissement de ${user.tag} sans sanction correspondante.`,
            );
        } catch (err) {
            console.error('[Moderation] Debannissement non enregistre :', err);
        }
    },
};

export = event;
