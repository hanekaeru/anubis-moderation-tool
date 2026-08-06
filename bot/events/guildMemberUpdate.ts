import { Events } from 'discord.js';
import type { BotEvent } from '../src/types';
import { IdentityEventType } from '@anubis/shared';
import prisma from '../src/prisma';
import * as referentiel from '../src/collectors/referentiel';

const event: BotEvent<typeof Events.GuildMemberUpdate> = {
    name: Events.GuildMemberUpdate,
    once: false,
    async execute(ancien, nouveau) {
        const guildId = nouveau.guild.id;

        try {
            if (ancien.nickname !== nouveau.nickname) {
                await prisma.member.updateMany({
                    where: { guildId, userId: nouveau.id },
                    data: { nickname: nouveau.nickname ?? null },
                });

                await referentiel.enregistrerEvenementIdentite(
                    guildId, nouveau.id, IdentityEventType.NICKNAME_CHANGED,
                    ancien.nickname ?? null, nouveau.nickname ?? null,
                );
            }

            if (ancien.premiumSince?.getTime() !== nouveau.premiumSince?.getTime()) {
                await prisma.member.updateMany({
                    where: { guildId, userId: nouveau.id },
                    data: { boostingSince: nouveau.premiumSince ?? null },
                });
            }

            const { ajoutes, retires } = await referentiel.synchroniserRoles(nouveau);

            if (ajoutes.length || retires.length) {
                await referentiel.enregistrerEvenementsRoles(
                    guildId, nouveau.id, ajoutes, retires,
                );
            }
        } catch (err) {
            console.error('[Referentiel] Mise a jour de membre non enregistree :', err);
        }
    },
};

export = event;
