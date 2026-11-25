import { EmbedBuilder, MessageFlags, PermissionFlagsBits, type ButtonInteraction } from "discord.js";
import { LFG_CLOSE_PREFIX, annonceFermee } from "../collectors/lfg";

/**
 * « Groupe complet » : seul l'auteur de l'annonce, ou un moderateur, la ferme.
 * L'auteur se lit dans l'identifiant du bouton, pose a la publication.
 */
export async function handleLfgClose(interaction: ButtonInteraction): Promise<void> {
	if (!interaction.inCachedGuild()) return;
	const auteurId = interaction.customId.slice(LFG_CLOSE_PREFIX.length);

	if (
		interaction.user.id !== auteurId &&
		!interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)
	) {
		await interaction.reply({
			content: "Seule la personne qui a posté l'annonce peut la fermer.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const [premier] = interaction.message.embeds;
	await interaction.update({
		embeds: premier ? [annonceFermee(EmbedBuilder.from(premier))] : [],
		components: [],
	});
}
