const { SlashCommandBuilder } = require('discord.js');
const prisma = require('../../src/prisma');

require('dotenv').config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Ping test command!'),
    async execute(message) {
        const debut = Date.now();
        try {
            await prisma.$queryRaw`SELECT 1`;
            await message.reply(
                `Pong ! Base de donnees joignable en ${Date.now() - debut} ms.`,
            );
        } catch (err) {
            console.error('[Ping] Base injoignable :', err);
            await message.reply('Pong ! En revanche, la base ne repond pas.');
        }
    }
};
