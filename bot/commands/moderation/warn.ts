import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { WARNING_SEVERITY_LABELS, WarningSeverity } from '@anubis/shared';
import type { Command } from '../../src/types';
import * as referentiel from '../../src/collectors/referentiel';
import * as moderation from '../../src/collectors/moderation';
import { hierarchyIssue } from '../../src/utils/moderationGuard';
import { notifyMember } from '../../src/utils/notifyMember';

const SEVERITY_CHOICES = Object.values(WarningSeverity).map(severity => ({
    name: WARNING_SEVERITY_LABELS[severity],
    value: severity,
}));

const command: Command = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Avertir un membre.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option
            .setName('membre')
            .setDescription('Le membre a avertir.')
            .setRequired(true))
        .addStringOption(option => option
            .setName('raison')
            .setDescription('Motif de l\'avertissement.')
            .setMinLength(3)
            .setMaxLength(512)
            .setRequired(true))
        .addStringOption(option => option
            .setName('severite')
            .setDescription('Gravite de l\'avertissement.')
            .addChoices(...SEVERITY_CHOICES)
            .setRequired(false))
        .addIntegerOption(option => option
            .setName('points')
            .setDescription('Poids dans le cumul (1 par defaut).')
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(false)),
    async execute(interaction) {
        if (!interaction.inCachedGuild()) return;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
            await interaction.reply({
                content: 'Tu n\'as pas la permission d\'avertir des membres.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const targetUser = interaction.options.getUser('membre', true);
        const reason = interaction.options.getString('raison', true);
        const severity = (interaction.options.getString('severite') ?? WarningSeverity.LOW) as WarningSeverity;
        const points = interaction.options.getInteger('points') ?? 1;

        const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (target) {
            const issue = hierarchyIssue(interaction.member, target);
            if (issue) {
                await interaction.reply({ content: issue, flags: MessageFlags.Ephemeral });
                return;
            }
        }

        await referentiel.upsertUser(interaction.user);
        await referentiel.upsertUser(targetUser);

        await moderation.createWarning({
            guildId: interaction.guildId,
            userId: targetUser.id,
            moderatorId: interaction.user.id,
            reason,
            severity,
            points,
        });

        if (target) {
            await notifyMember(
                target.user,
                `Tu as recu un avertissement sur **${interaction.guild.name}**.\nMotif : ${reason}`,
            );
        }

        await interaction.reply({
            content: `${targetUser.tag} a ete averti (${WARNING_SEVERITY_LABELS[severity]}). Motif : ${reason}`,
            flags: MessageFlags.Ephemeral,
        });
    },
};

export = command;
