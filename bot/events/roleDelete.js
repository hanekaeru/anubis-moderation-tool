const { Events } = require('discord.js');
const referentiel = require('../src/collectors/referentiel');

module.exports = {
    name: Events.GuildRoleDelete,
    once: false,
    async execute(role, client) {
        try {
            await referentiel.marquerRoleSupprime(role.id);
        } catch (err) {
            console.error('[Referentiel] Suppression de role non enregistree :', err);
        }
    },
};
