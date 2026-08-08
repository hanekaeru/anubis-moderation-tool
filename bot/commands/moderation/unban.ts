import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../src/types';
import * as referentiel from '../../src/collectors/referentiel';
import * as moderation from '../../src/collectors/moderation';

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Lever le bannissement d\'un membre.')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(option => option
            .setName('membre')
            .setDescription('Le membre banni a debannir (identifiant Discord).')
            .setRequired(true))
        .addStringOption(option => option
            .setName('raison')
            .setDescription('Motif de la levee.')
            .setMinLength(3)
            .setMaxLength(500)
            .setRequired(true)),
    async execute(interaction) {
        if (!interaction.inCachedGuild()) return;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
            await interaction.reply({
                content: 'Tu n\'as pas la permission de debannir des membres.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const targetUser = interaction.options.getUser('membre', true);
        const reason = interaction.options.getString('raison', true);

        try {
            await interaction.guild.members.unban(targetUser, reason);
        } catch (err) {
            console.error('[Moderation] Levee de ban Discord echouee :', err);
            await interaction.reply({
                content: 'La levee du bannissement a echoue cote Discord (le membre n\'est peut-etre pas banni).',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await referentiel.upsertUser(interaction.user);
        await referentiel.upsertUser(targetUser);

        const revoked = await moderation.revokeActiveSanction(
            interaction.guildId, targetUser.id, 'BAN', interaction.user.id, reason,
        );

        const note = revoked
            ? ''
            : ' (aucun bannissement actif trouve en base, le ban Discord a quand meme ete leve)';
        await interaction.reply({
            content: `${targetUser.tag} a ete debanni.${note}`,
            flags: MessageFlags.Ephemeral,
        });
    },
};

export = command;
