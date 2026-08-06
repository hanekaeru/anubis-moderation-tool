const { Events } = require('discord.js');
const referentiel = require('../src/collectors/referentiel');

module.exports = {
    name: Events.ChannelCreate,
    once: false,
    async execute(channel, client) {
        try {
            await referentiel.upsertChannel(channel);
        } catch (err) {
            console.error('[Referentiel] Salon non enregistre :', err);
        }
    },
};
