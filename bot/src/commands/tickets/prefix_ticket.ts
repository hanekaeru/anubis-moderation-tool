import {
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import {
	MAX_TICKET_PREFIX_LENGTH,
	slugifyChannelPart,
} from "@anubis/shared";
import type { Command } from "../../types";
import * as referentiel from "../../collectors/referentiel";
import * as tickets from "../../collectors/tickets";

/**
 * Prefixe qu'un moderateur donne aux salons des tickets qu'il prend.
 *
 * Le prefixe est **normalise a l'enregistrement**, pas a l'usage : Discord
 * mettrait de toute facon le nom du salon en minuscules et remplacerait ce
 * qu'il ne comprend pas, et un moderateur qui saisit « Hané » doit voir tout
 * de suite le « hane » qui sera reellement pose. Le dashboard, qui edite le
 * meme champ, applique la meme normalisation.
 */
const command: Command = {
	data: new SlashCommandBuilder()
		.setName("prefix_ticket")
		.setDescription(
			"STAFF - Choisit le préfixe des salons de tickets que tu prends en charge.",
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addStringOption((option) =>
			option
				.setName("prefix")
				.setDescription("Par exemple « hane » pour obtenir hane-membre-0001.")
				.setRequired(true)
				.setMaxLength(40),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
			await interaction.reply({
				content: "Tu n'as pas la permission de gérer les tickets.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const saisi = interaction.options.getString("prefix", true);
		const prefix = slugifyChannelPart(saisi).slice(0, MAX_TICKET_PREFIX_LENGTH);

		if (!prefix) {
			await interaction.reply({
				content:
					"Ce préfixe ne contient aucun caractère utilisable dans un nom de salon (lettres et chiffres).",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// `ticket_moderator_prefixes` porte une cle etrangere vers
		// `discord_users` : un moderateur jamais croise par le referentiel
		// ferait echouer l'enregistrement.
		await referentiel.upsertUser(interaction.user);
		await tickets.setPrefix(interaction.guildId, interaction.user.id, prefix);

		const apercu = `${prefix}-membre-0001`;

		await interaction.editReply({
			content:
				prefix === saisi
					? `Préfixe enregistré : \`${prefix}\`. Les salons que tu prendras s'appelleront \`${apercu}\`.`
					: `Préfixe enregistré : \`${prefix}\` (adapté depuis « ${saisi} », Discord n'accepte que lettres et chiffres). Les salons que tu prendras s'appelleront \`${apercu}\`.`,
		});
	},
};

export = command;
