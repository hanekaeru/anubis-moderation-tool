const { Events } = require('discord.js');
const prisma = require('../src/prisma');

module.exports = {
    name: Events.GuildMemberRemove,
    once: false,
    async execute(member, client) {
        try {
            // `updateMany` et non `update` : un membre jamais synchronise n'a
            // pas de ligne, et un depart ne doit pas lever d'exception pour ca.
            await prisma.member.updateMany({
                where: { guildId: member.guild.id, userId: member.id },
                data: { status: 'LEFT', leftAt: new Date() },
            });

            // Les roles portes ne veulent plus rien dire une fois parti ;
            // l'historique des ajouts et retraits, lui, est conserve.
            await prisma.memberRole.deleteMany({
                where: { guildId: member.guild.id, userId: member.id },
            });

            console.log(`[Referentiel] Depart de ${member.user?.tag ?? member.id}.`);
        } catch (err) {
            console.error('[Referentiel] Depart non enregistre :', err);
        }
    },
};
