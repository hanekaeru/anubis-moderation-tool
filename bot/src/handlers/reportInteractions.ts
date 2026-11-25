import {
	MessageFlags,
	PermissionFlagsBits,
	type ButtonInteraction,
	type ModalSubmitInteraction,
} from "discord.js";
import {
	REPORT_MODAL_PREFIX,
	REPORT_REASON_INPUT,
	REPORT_WHOIS_PREFIX,
	marquerSignale,
	publier,
	reprendre,
} from "../collectors/reports";
import { ficheWhois } from "../collectors/whois";

/** Motif saisi, puis publication dans le salon des signalements. */
export async function handleReportModal(interaction: ModalSubmitInteraction): Promise<void> {
	if (!interaction.inCachedGuild()) return;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const capture = reprendre(interaction.customId.slice(REPORT_MODAL_PREFIX.length));
	// La cle vient du client : elle doit designer une capture de ce serveur,
	// faite par cette personne.
	if (!capture || capture.guildId !== interaction.guildId || capture.reporterId !== interaction.user.id) {
		await interaction.editReply(
			"Ce signalement a expiré. Refais un clic droit sur le message pour recommencer.",
		);
		return;
	}

	const motif = interaction.fields.getTextInputValue(REPORT_REASON_INPUT).trim() || null;
	const publie = await publier(interaction.guild, capture, motif);
	if (!publie) {
		console.error(`[Signalements] Aucun salon de signalements configuré sur ${interaction.guildId}.`);
		await interaction.editReply(
			"Le signalement n'a pas pu être transmis : aucun salon n'est configuré pour les recevoir. Ouvre un ticket pour prévenir le staff.",
		);
		return;
	}

	marquerSignale(capture);
	await interaction.editReply("Merci, le staff a reçu ton signalement.");
}

/**
 * « Fiche de l'auteur » / « Fiche du signaleur » : la meme fiche que
 * `/whois`, en reponse ephemere. Le salon des signalements est reserve au
 * staff, mais la permission est **reverifiee** : un bouton se clique depuis
 * n'importe quel salon ou le message aurait ete transfere.
 */
export async function handleReportWhoisButton(interaction: ButtonInteraction): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	if (!interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)) {
		await interaction.reply({
			content: "Seul le staff peut ouvrir cette fiche.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	const userId = interaction.customId.slice(REPORT_WHOIS_PREFIX.length);
	const user = await interaction.client.users.fetch(userId).catch(() => null);
	if (!user) {
		await interaction.editReply("Ce compte n'existe plus sur Discord.");
		return;
	}

	await interaction.editReply({
		embeds: await ficheWhois(interaction.guild, user),
		allowedMentions: { parse: [] },
	});
}
