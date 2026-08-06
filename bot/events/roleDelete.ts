import { Events } from 'discord.js';
import type { BotEvent } from '../src/types';
import * as referentiel from '../src/collectors/referentiel';

const event: BotEvent<typeof Events.GuildRoleDelete> = {
    name: Events.GuildRoleDelete,
    once: false,
    async execute(role) {
        try {
            await referentiel.marquerRoleSupprime(role.id);
        } catch (err) {
            console.error('[Referentiel] Suppression de role non enregistree :', err);
        }
    },
};

export = event;
