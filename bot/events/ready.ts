import { Events } from 'discord.js';
import type { BotEvent } from '../src/types';
import * as referentiel from '../src/collectors/referentiel';
import { checkAppliedSanctions, checkExpiredShadowbans, checkRevokedSanctions } from '../src/tasks/sanctionSync';

const SANCTION_SYNC_INTERVAL_MS = 30_000;

const event: BotEvent<typeof Events.ClientReady> = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        console.log(`Deployed on ${process.env.NODE_ENV} env...`);

        for (const guild of client.guilds.cache.values()) {
            try {
                await referentiel.synchroniserServeur(guild);
            } catch (err) {
                console.error(`[Referentiel] Échec sur ${guild.name} :`, err);
            }
        }

        setInterval(() => {
            checkExpiredShadowbans(client).catch(err => {
                console.error('[Shadowban] Vérification des expirations échouée :', err);
            });
            checkRevokedSanctions(client).catch(err => {
                console.error('[Moderation] Synchronisation des révocations échouée :', err);
            });
            checkAppliedSanctions(client).catch(err => {
                console.error('[Moderation] Récupération des sanctions actives échouée :', err);
            });
        }, SANCTION_SYNC_INTERVAL_MS);
    },
};

export = event;
