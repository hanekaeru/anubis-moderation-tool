import { Events } from 'discord.js';
import type { BotEvent } from '../src/types';
import * as referentiel from '../src/collectors/referentiel';

const event: BotEvent<typeof Events.GuildRoleCreate> = {
    name: Events.GuildRoleCreate,
    once: false,
    async execute(role) {
        try {
            await referentiel.upsertRole(role);
        } catch (err) {
            console.error('[Referentiel] Role non enregistre :', err);
        }
    },
};

export = event;
