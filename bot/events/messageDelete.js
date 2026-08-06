const { Events } = require('discord.js');
const activite = require('../src/collectors/activite');

module.exports = {
    name: Events.MessageDelete,
    once: false,
    async execute(message, client) {
        if (!message?.guild || message.author?.bot) return;

        // Discord ne renvoie que l'identifiant pour un message absent du cache :
        // une suppression ancienne n'est donc pas comptabilisee, faute d'auteur.
        if (!message.author) return;

        activite.enregistrerSuppression(message);
    },
};
