import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  DURATION_UNIT_CHOICES_TIMED,
  DURATION_UNIT_LABELS,
  DurationUnit,
  durationToSeconds,
  MAX_TIMEOUT_SECONDS,
} from '@anubis/shared';
import type { Command } from '../../src/types';
import * as referentiel from '../../src/collectors/referentiel';
import * as moderation from '../../src/collectors/moderation';
import { hierarchyIssue } from '../../src/utils/moderationGuard';
import { notifyMember } from '../../src/utils/notifyMember';
import { formatDuration } from '../../src/utils/formatDuration';
import * as colors from '../../utils/constantes';

const UNIT_CHOICES = DURATION_UNIT_CHOICES_TIMED
  .map(unit => ({ name: DURATION_UNIT_LABELS[unit], value: unit }));

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
      .setDescription('Durée de l\'exclusion.')
      .setMinValue(1)
      .setRequired(true))
    .addStringOption(option => option
      .setName('unite')
      .setDescription('Unité de la durée.')
      .addChoices(...UNIT_CHOICES)
      .setRequired(true))
    .addStringOption(option => option
      .setName('raison')
      .setDescription('Motif de l\'exclusion.')
      .setMinLength(3)
      .setMaxLength(512)
      .setRequired(true)),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;

    const responseEmbed = new EmbedBuilder()
      .setColor(colors.info)
      .setTitle("Anubis - /mute")
      .setTimestamp()
      .setFooter({ text: "En cas de problème, vous pouvez ouvrir un ticket ou en parler aux administrateurs." })

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      responseEmbed.setDescription(`Tu n'as pas la permission d'exclure temporairement des membres.`),
        await interaction.reply({
          embeds: [responseEmbed],
          flags: MessageFlags.Ephemeral
        });
      return;
    }

    const targetUser = interaction.options.getUser('membre', true);
    const amount = interaction.options.getInteger('duree', true);
    const unit = interaction.options.getString('unite', true) as DurationUnit;
    const reason = interaction.options.getString('raison', true);

    const durationSeconds = durationToSeconds(amount, unit);
    if (durationSeconds === null || durationSeconds > MAX_TIMEOUT_SECONDS) {
      responseEmbed
        .setDescription(`Un timeout Discord ne peut pas depasser 28 jours. Utilise \`/shadowban\` pour une restriction plus longue ou permanente.`)
        .setColor(colors.danger);
      await interaction.reply({
        embeds: [responseEmbed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!target) {
      responseEmbed
        .setDescription(`Ce membre n'est pas sur ce serveur.`)
        .setColor(colors.danger);
      await interaction.reply({ embeds: [responseEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

    const issue = hierarchyIssue(interaction.member, target);
    if (issue) {
      await interaction.reply({ content: issue, flags: MessageFlags.Ephemeral });
      return;
    }

    if (!target.moderatable) {
      responseEmbed
        .setDescription(`Je ne peux pas exclure ce membre (rôle trop haut ou permissions insuffisantes).`)
        .setColor(colors.danger);
      await interaction.reply({
        embeds: [responseEmbed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await referentiel.upsertUser(interaction.user);
    await referentiel.upsertUser(target.user);
    await notifyMember(
      target.user,
      `Tu as ete exclu temporairement de **${interaction.guild.name}**.\nMotif : ${reason}\nDurée : ${formatDuration(amount, unit)}`,
    );

    try {
      await target.timeout(durationSeconds * 1000, reason);
    } catch (err) {
      console.error('[Moderation] Timeout Discord échoué :', err);
      responseEmbed
        .setDescription(`L'exclusion temporaire a échoué. Le problème venant de Discord.`)
        .setColor(colors.danger);
      await interaction.reply({
        embeds: [responseEmbed],
        flags: MessageFlags.Ephemeral,
      });
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

    responseEmbed
      .setDescription(`<@${target.user.id}> est exclu temporairement. \nDurée : ${formatDuration(amount, unit)}\nMotif : ${reason}`)
      .setColor(colors.success);
    await interaction.reply({
      embeds: [responseEmbed],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export = command;
