const { Events } = require('discord.js');
const referentiel = require('../src/collectors/referentiel');

module.exports = {
    name: Events.UserUpdate,
    once: false,
    async execute(ancien, nouveau, client) {
        try {
            await referentiel.upsertUser(nouveau);

            // L'identite est globale a Discord, pas propre a un serveur :
            // `guildId` reste nul, la fiche membre lit l'historique par
            // utilisateur.
            if (ancien.username !== nouveau.username) {
                await referentiel.enregistrerEvenementIdentite(
                    null, nouveau.id, 'USERNAME_CHANGED',
                    ancien.username, nouveau.username,
                );
            }

            if (ancien.globalName !== nouveau.globalName) {
                await referentiel.enregistrerEvenementIdentite(
                    null, nouveau.id, 'GLOBAL_NAME_CHANGED',
                    ancien.globalName ?? null, nouveau.globalName ?? null,
                );
            }

            if (ancien.avatar !== nouveau.avatar) {
                await referentiel.enregistrerEvenementIdentite(
                    null, nouveau.id, 'AVATAR_CHANGED',
                    ancien.avatar ?? null, nouveau.avatar ?? null,
                );
            }
        } catch (err) {
            console.error('[Referentiel] Changement d\'identite non enregistre :', err);
        }
    },
};
