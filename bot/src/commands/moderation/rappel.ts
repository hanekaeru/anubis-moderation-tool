import {
	PermissionFlagsBits,
	SlashCommandBuilder,
	time,
} from "discord.js";
import {
	MAX_REMINDER_SECONDS,
	formatDurationSeconds,
	parseCompactDelay,
} from "@anubis/shared";
import * as referentiel from "../../collectors/referentiel";
import prisma from "../../prisma";
import type { Command } from "../../types";
import {
	baseCommandEmbed,
	repondreEchec,
	repondreSucces,
} from "../../utils/commandEmbed";

/**
 * Pense-bete que le staff se pose a lui-meme.
 *
 * Le rappel vit en base plutot qu'en memoire : un `setTimeout` disparaitrait au
 * premier redeploiement, et un rappel qu'on croit pose mais qui ne vient jamais
 * est pire que pas de rappel du tout. C'est `src/tasks/reminders.ts` qui le
 * livre, sur la meme boucle que les autres rattrapages.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("rappel")
		.setDescription("Se poser un rappel, livré en message privé.")
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addStringOption((option) =>
			option
				.setName("delai")
				.setDescription("Dans combien de temps : 30m, 2h, 1h30, 3j.")
				.setRequired(true)
				.setMaxLength(20),
		)
		.addStringOption((option) =>
			option
				.setName("note")
				.setDescription("Ce dont il faut se souvenir.")
				.setRequired(true)
				.setMinLength(3)
				.setMaxLength(500),
		)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Membre concerné, si le rappel en vise un.")
				.setRequired(false),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		const responseEmbed = baseCommandEmbed("rappel");

		const saisie = interaction.options.getString("delai", true);
		const secondes = parseCompactDelay(saisie);

		if (secondes === null) {
			await repondreEchec(
				interaction,
				responseEmbed,
				`Délai incompris : « ${saisie} ». Formats acceptés : \`30m\`, \`2h\`, \`1h30\`, \`3j\`.`,
			);
			return;
		}

		if (secondes > MAX_REMINDER_SECONDS) {
			await repondreEchec(
				interaction,
				responseEmbed,
				`Un rappel ne peut pas dépasser ${formatDurationSeconds(MAX_REMINDER_SECONDS)}.`,
			);
			return;
		}

		const note = interaction.options.getString("note", true);
		const cible = interaction.options.getUser("membre");
		const remindAt = new Date(Date.now() + secondes * 1000);

		// `staff_reminders.user_id` porte une cle etrangere vers `discord_users` :
		// un membre du staff que le referentiel n'a jamais croise ferait echouer
		// l'insertion.
		await referentiel.upsertUser(interaction.user);

		await prisma.staffReminder.create({
			data: {
				guildId: interaction.guildId,
				userId: interaction.user.id,
				channelId: interaction.channelId,
				message: note,
				targetId: cible?.id ?? null,
				remindAt,
			},
		});

		const surQui = cible ? ` À propos de ${cible}.` : "";
		await repondreSucces(
			interaction,
			responseEmbed,
			`Rappel posé pour ${time(remindAt, "R")} (${time(remindAt, "f")}).${surQui}`,
		);
	},
};

export = command;
