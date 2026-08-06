const { Events } = require('discord.js');
const referentiel = require('../src/collectors/referentiel');

module.exports = {
    name: Events.ChannelUpdate,
    once: false,
    async execute(ancien, nouveau, client) {
        try {
            await referentiel.upsertChannel(nouveau);
        } catch (err) {
            console.error('[Referentiel] Salon non mis a jour :', err);
        }
    },
};
