const { Events } = require('discord.js');
const referentiel = require('../src/collectors/referentiel');

module.exports = {
    name: Events.ChannelDelete,
    once: false,
    async execute(channel, client) {
        try {
            // Suppression logique : les statistiques de messages referencent ce
            // salon, l'effacer viderait l'historique d'activite des membres.
            await referentiel.marquerSalonSupprime(channel.id);
        } catch (err) {
            console.error('[Referentiel] Suppression de salon non enregistree :', err);
        }
    },
};
