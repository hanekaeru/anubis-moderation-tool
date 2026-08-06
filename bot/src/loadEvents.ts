import fs from 'node:fs';
import path from 'node:path';
import type { Client } from 'discord.js';
import type { BotEvent } from './types';

const EVENTS_DIR = path.join(__dirname, '..', 'events');

function isEventModule(value: unknown): value is BotEvent {
    return typeof value === 'object' && value !== null && 'name' in value && 'execute' in value;
}

/**
 * Decouvre et enregistre les gestionnaires d'evenements dans `events/*.ts`.
 *
 * Chaque fichier declare son propre `name` litteral (`BotEvent<Events.X>`),
 * mais une fois charges dynamiquement ici ils redeviennent un `BotEvent`
 * generique : `Key` ne peut plus etre retrouve statiquement d'un fichier a
 * l'autre. `execute` est donc invoque via un type erase assume, seul point
 * non type-safe du loader — chaque fichier individuel reste, lui, verifie
 * par le compilateur.
 */
export function registerEvents(client: Client): void {
    const eventFiles = fs.readdirSync(EVENTS_DIR)
        .filter(file => file.endsWith('.ts') || file.endsWith('.js'));

    for (const file of eventFiles) {
        const filePath = path.join(EVENTS_DIR, file);
        const event: unknown = require(filePath);

        if (!isEventModule(event)) {
            console.log(`[WARNING] The event at ${filePath} is missing a required "name" or "execute" property.`);
            continue;
        }

        const execute = event.execute as (...args: unknown[]) => Promise<void> | void;

        if (event.once) {
            client.once(event.name, (...args) => execute(...args, client));
        } else {
            client.on(event.name, (...args) => execute(...args, client));
        }
    }
}
