const { Events } = require('discord.js');
const prisma = require('../src/prisma');
const referentiel = require('../src/collectors/referentiel');

module.exports = {
    name: Events.GuildMemberUpdate,
    once: false,
    async execute(ancien, nouveau, client) {
        const guildId = nouveau.guild.id;

        try {
            if (ancien.nickname !== nouveau.nickname) {
                await prisma.member.updateMany({
                    where: { guildId, userId: nouveau.id },
                    data: { nickname: nouveau.nickname ?? null },
                });

                await referentiel.enregistrerEvenementIdentite(
                    guildId, nouveau.id, 'NICKNAME_CHANGED',
                    ancien.nickname ?? null, nouveau.nickname ?? null,
                );
            }

            if (ancien.premiumSince?.getTime() !== nouveau.premiumSince?.getTime()) {
                await prisma.member.updateMany({
                    where: { guildId, userId: nouveau.id },
                    data: { boostingSince: nouveau.premiumSince ?? null },
                });
            }

            // Les roles changent souvent sans que rien d'autre ne bouge :
            // la comparaison porte sur l'etat en base, pas sur l'ancien objet,
            // pour rester juste meme apres un redemarrage.
            const { ajoutes, retires } = await referentiel.synchroniserRoles(nouveau);

            if (ajoutes.length || retires.length) {
                await referentiel.enregistrerEvenementsRoles(
                    guildId, nouveau.id, ajoutes, retires,
                );
            }
        } catch (err) {
            console.error('[Referentiel] Mise a jour de membre non enregistree :', err);
        }
    },
};
