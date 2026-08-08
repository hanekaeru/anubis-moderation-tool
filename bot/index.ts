import { Client, Events, GatewayIntentBits } from 'discord.js';
import prisma from './src/prisma';
import activite from './src/collectors/activite';
import xpManager from './src/collectors/xp';
import { loadCommands } from './src/loadCommands';
import { registerEvents } from './src/loadEvents';
import { requireEnv } from './src/env';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
    ],
});

client.commands = loadCommands();
registerEvents(client);

client.on(Events.Error, (error) => {
    console.error('[Discord] Erreur du client :', error);
});

/**
 * Arret propre.
 *
 * L'XP et les statistiques d'activite vivent en memoire entre deux vidages :
 * quitter sans les ecrire perdrait tout ce qui a ete accumule depuis le dernier
 * flush, soit jusqu'a une quinzaine de secondes d'activite.
 */
let arretEnCours = false;

async function arreter(signal: NodeJS.Signals): Promise<void> {
    if (arretEnCours) return;
    arretEnCours = true;

    console.log(`[Bot] ${signal} recu, vidage des buffers avant l'arret...`);

    try {
        await Promise.allSettled([xpManager.flush(), activite.vider()]);
    } catch (err) {
        console.error('[Bot] Vidage incomplet :', err);
    }

    await client.destroy();
    await prisma.$disconnect();

    console.log('[Bot] Arret termine.');
    process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => { void arreter(signal); });
}

client.login(requireEnv('BOT_TOKEN'));
