import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  DURATION_UNIT_CHOICES_WITH_PERMANENT,
  DURATION_UNIT_LABELS,
  DurationUnit,
  durationToSeconds,
} from '@anubis/shared';
import type { Command } from '../../src/types';
import * as referentiel from '../../src/collectors/referentiel';
import * as moderation from '../../src/collectors/moderation';
import * as shadowbanRole from '../../src/collectors/shadowbanRole';
import { hierarchyIssue } from '../../src/utils/moderationGuard';
import { notifyMember } from '../../src/utils/notifyMember';
import { formatDuration } from '../../src/utils/formatDuration';
import * as colors from '../../utils/constantes';

const UNIT_CHOICES = DURATION_UNIT_CHOICES_WITH_PERMANENT
  .map(unit => ({ name: DURATION_UNIT_LABELS[unit], value: unit }));

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('shadowban')
    .setDescription('Restreindre l\'accès d\'un membre via un rôle dédié (peut être permanent).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option => option
      .setName('membre')
      .setDescription('Le membre dont l\'accès doit être restreint.')
      .setRequired(true))
    .addIntegerOption(option => option
      .setName('duree')
      .setDescription('Durée de la restriction (ignorée si unité = Permanent).')
      .setMinValue(1)
      .setRequired(true))
    .addStringOption(option => option
      .setName('unite')
      .setDescription('Unité de la durée.')
      .addChoices(...UNIT_CHOICES)
      .setRequired(true))
    .addStringOption(option => option
      .setName('raison')
      .setDescription('Motif de la réstriction.')
      .setMinLength(3)
      .setMaxLength(512)
      .setRequired(true)),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;

    const responseEmbed = new EmbedBuilder()
      .setColor(colors.info)
      .setTitle("Anubis - /shadowban")
      .setTimestamp()
      .setFooter({ text: "En cas de problème, vous pouvez ouvrir un ticket ou en parler aux administrateurs." })

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      responseEmbed
        .setDescription(`Tu n'as pas la permission de restreindre l'accès aux membres.`)
        .setColor(colors.danger);
      await interaction.reply({
        embeds: [responseEmbed],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      responseEmbed
        .setDescription(`Je n'ai pas la permission de gérer les rôles de ce serveur.`)
        .setColor(colors.danger);
      await interaction.reply({
        embeds: [responseEmbed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetUser = interaction.options.getUser('membre', true);
    const amount = interaction.options.getInteger('duree', true);
    const unit = interaction.options.getString('unite', true) as DurationUnit;
    const reason = interaction.options.getString('raison', true);

    const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!target) {
      responseEmbed
        .setDescription(`Ce membre n'est pas sur le serveur.`)
        .setColor(colors.danger);
      await interaction.reply({ embeds: [responseEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const issue = hierarchyIssue(interaction.member, target);
    if (issue) {
      await interaction.reply({ content: issue, flags: MessageFlags.Ephemeral });
      return;
    }

    const durationSeconds = durationToSeconds(amount, unit);

    await referentiel.upsertUser(interaction.user);
    await referentiel.upsertUser(target.user);

    try {
      await shadowbanRole.applyShadowban(target, reason);
    } catch (err) {
      console.error('[Shadowban] Attribution du rôle échouée :', err);
      responseEmbed
        .setDescription('Le shadowban a échoué (rôle trop haut ou permissions insuffisantes).')
        .setColor(colors.danger);
      await interaction.reply({
        embeds: [responseEmbed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await notifyMember(
      target.user,
      `Ton accès à **${interaction.guild.name}** a été restreint.\nMotif : ${reason}\nDurée : ${formatDuration(amount, unit)}`,
    );

    await moderation.createSanction({
      guildId: interaction.guildId,
      userId: target.id,
      moderatorId: interaction.user.id,
      type: 'SHADOWBAN',
      reason,
      durationSeconds,
    });

    responseEmbed
      .setDescription(`<@${target.user.id}> est shadowban. \nDurée : ${formatDuration(amount, unit)}\nMotif : ${reason}`)
      .setColor(colors.success);
    await interaction.reply({
      embeds: [responseEmbed],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export = command;
