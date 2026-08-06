import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { SANCTION_DURATION_PRESETS } from '@anubis/shared';
import type { Command } from '../../src/types';
import * as referentiel from '../../src/collectors/referentiel';
import * as moderation from '../../src/collectors/moderation';
import { hierarchyIssue } from '../../src/utils/moderationGuard';
import { notifyMember } from '../../src/utils/notifyMember';

// Memes paliers que le formulaire du dashboard (`SANCTION_DURATION_PRESETS`),
// sans "Permanent" : un timeout Discord exige toujours une duree.
const DURATION_CHOICES = SANCTION_DURATION_PRESETS
    .filter((preset): preset is { label: string; seconds: number } => preset.seconds !== null)
    .map(preset => ({ name: preset.label, value: preset.seconds }));

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Exclure temporairement un membre (timeout Discord).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option
            .setName('membre')
            .setDescription('Le membre a exclure temporairement.')
            .setRequired(true))
        .addIntegerOption(option => option
            .setName('duree')
            .setDescription('Duree de l\'exclusion.')
            .addChoices(...DURATION_CHOICES)
            .setRequired(true))
        .addStringOption(option => option
            .setName('raison')
            .setDescription('Motif de l\'exclusion.')
            .setMinLength(3)
            .setMaxLength(512)
            .setRequired(true)),
    async execute(interaction) {
        if (!interaction.inCachedGuild()) return;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            await interaction.reply({
                content: 'Tu n\'as pas la permission d\'exclure temporairement des membres.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const targetUser = interaction.options.getUser('membre', true);
        const durationSeconds = interaction.options.getInteger('duree', true);
        const reason = interaction.options.getString('raison', true);

        const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!target) {
            await interaction.reply({ content: 'Ce membre n\'est pas sur ce serveur.', flags: MessageFlags.Ephemeral });
            return;
        }

        const issue = hierarchyIssue(interaction.member, target);
        if (issue) {
            await interaction.reply({ content: issue, flags: MessageFlags.Ephemeral });
            return;
        }

        if (!target.moderatable) {
            await interaction.reply({
                content: 'Je ne peux pas exclure ce membre (role trop haut ou permissions insuffisantes).',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await referentiel.upsertUser(interaction.user);
        await referentiel.upsertUser(target.user);
        await notifyMember(
            target.user,
            `Tu as ete exclu temporairement de **${interaction.guild.name}**.\nMotif : ${reason}`,
        );

        try {
            await target.timeout(durationSeconds * 1000, reason);
        } catch (err) {
            console.error('[Moderation] Timeout Discord echoue :', err);
            await interaction.reply({ content: 'L\'exclusion temporaire a echoue cote Discord.', flags: MessageFlags.Ephemeral });
            return;
        }

        await moderation.createSanction({
            guildId: interaction.guildId,
            userId: target.id,
            moderatorId: interaction.user.id,
            type: 'TIMEOUT',
            reason,
            durationSeconds,
        });

        await interaction.reply({
            content: `${target.user.tag} est exclu temporairement. Motif : ${reason}`,
            flags: MessageFlags.Ephemeral,
        });
    },
};

export = command;
