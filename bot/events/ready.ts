import { Events } from 'discord.js';
import type { BotEvent } from '../src/types';
import * as referentiel from '../src/collectors/referentiel';

const event: BotEvent<typeof Events.ClientReady> = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        console.log(`Deployed on ${process.env.NODE_ENV} env...`);

        // Synchronisation complete au demarrage : rien de ce qui s'est passe
        // pendant que le bot etait hors ligne n'a genere d'evenement, seule une
        // relecture de l'etat courant permet de rattraper.
        for (const guild of client.guilds.cache.values()) {
            try {
                await referentiel.synchroniserServeur(guild);
            } catch (err) {
                // Un serveur en echec ne doit pas empecher les autres de se
                // synchroniser, ni empecher le bot de repondre.
                console.error(`[Referentiel] Echec sur ${guild.name} :`, err);
            }
        }
    },
};

export = event;
