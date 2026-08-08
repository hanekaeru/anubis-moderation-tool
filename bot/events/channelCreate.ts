import { Events } from 'discord.js';
import type { BotEvent } from '../src/types';
import * as referentiel from '../src/collectors/referentiel';
import * as shadowbanRole from '../src/collectors/shadowbanRole';

const event: BotEvent<typeof Events.ChannelCreate> = {
    name: Events.ChannelCreate,
    once: false,
    async execute(channel) {
        try {
            await referentiel.upsertChannel(channel);
        } catch (err) {
            console.error('[Referentiel] Salon non enregistre :', err);
        }

        try {
            await shadowbanRole.syncShadowbanOverwrite(channel);
        } catch (err) {
            console.error('[Shadowban] Synchronisation du nouveau salon echouee :', err);
        }
    },
};

export = event;
