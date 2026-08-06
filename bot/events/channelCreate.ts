import { Events } from 'discord.js';
import type { BotEvent } from '../src/types';
import * as referentiel from '../src/collectors/referentiel';

const event: BotEvent<typeof Events.ChannelCreate> = {
    name: Events.ChannelCreate,
    once: false,
    async execute(channel) {
        try {
            await referentiel.upsertChannel(channel);
        } catch (err) {
            console.error('[Referentiel] Salon non enregistre :', err);
        }
    },
};

export = event;
