const { Events } = require('discord.js');
const activite = require('../src/collectors/activite');

module.exports = {
    name: Events.MessageUpdate,
    once: false,
    async execute(ancien, nouveau, client) {
        const message = nouveau ?? ancien;
        if (!message?.guild || message.author?.bot) return;

        // Un message hors cache arrive partiel : sans auteur, il n'y a personne
        // a qui attribuer l'edition.
        if (!message.author) return;

        activite.enregistrerEdition(message);
    },
};
