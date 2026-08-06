const { Events } = require('discord.js');
const referentiel = require('../src/collectors/referentiel');

module.exports = {
    name: Events.GuildRoleCreate,
    once: false,
    async execute(role, client) {
        try {
            await referentiel.upsertRole(role);
        } catch (err) {
            console.error('[Referentiel] Role non enregistre :', err);
        }
    },
};
