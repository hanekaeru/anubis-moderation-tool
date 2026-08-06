import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../src/types';
import prisma from '../../src/prisma';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Ping test command!'),
    async execute(interaction) {
        const debut = Date.now();
        try {
            await prisma.$queryRaw`SELECT 1`;

            await interaction.reply(
                `Pong ! Base de donnees joignable en ${Date.now() - debut} ms.`,
            );
        } catch (err) {
            console.error('[Ping] Base injoignable :', err);
            await interaction.reply('Pong ! En revanche, la base ne repond pas.');
        }
    },
};

export = command;
