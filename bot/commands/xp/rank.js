const { SlashCommandBuilder } = require('discord.js');
const xpManager = require('../../src/collectors/xp');

require('dotenv').config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Get your current rank and XP on this server !'),
    async execute(message) {
        const xp = await xpManager.getXp(message.user.id, message.guild.id);
        const restant = await xpManager.getXpBeforeNextLevel(xp);

        const embed = {
            color: 0x0099ff,
            title: `${message.user.username}'s Rank`,
            fields: [
                { name: 'Current level', value: `Level ${await xpManager.getLevelFromXp(xp)}`, inline: true },
                {
                    name: 'Next level in',
                    // Au dernier palier il n'y a plus de niveau suivant :
                    // afficher "0 xp." laisserait croire a un niveau imminent.
                    value: restant > 0 ? `${restant} xp.` : 'Niveau maximal atteint.',
                    inline: true,
                },
                { name: 'Experience gained', value: `${xp} xp.`, inline: true },
            ],
        };

        await message.reply({ embeds: [embed] });
    }
};
