import { Events } from 'discord.js';
import type { BotEvent } from '../src/types';
import activite from '../src/collectors/activite';

const event: BotEvent<typeof Events.MessageUpdate> = {
    name: Events.MessageUpdate,
    once: false,
    async execute(ancien, nouveau) {
        const message = nouveau ?? ancien;
        if (!message?.guild || message.author?.bot) return;

        // Un message hors cache arrive partiel : sans auteur, il n'y a personne
        // a qui attribuer l'edition.
        if (!message.author) return;

        activite.enregistrerEdition(message);
    },
};

export = event;
