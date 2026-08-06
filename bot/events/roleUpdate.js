const { Events } = require('discord.js');
const referentiel = require('../src/collectors/referentiel');

module.exports = {
    name: Events.GuildRoleUpdate,
    once: false,
    async execute(ancien, nouveau, client) {
        try {
            await referentiel.upsertRole(nouveau);
        } catch (err) {
            console.error('[Referentiel] Role non mis a jour :', err);
        }
    },
};
