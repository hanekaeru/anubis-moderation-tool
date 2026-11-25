import { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags } from "discord.js";
import type { MessageContextMenuCommand } from "../../types";
import { capturer, modaleDeSignalement, refusDeSignalement } from "../../collectors/reports";

const REFUS: Record<string, string> = {
	"propre-message": "Tu ne peux pas signaler ton propre message.",
	"message-du-bot": "Les messages du bot ne se signalent pas : ouvre un ticket si l'un d'eux pose problème.",
	"deja-signale": "Tu as déjà signalé ce message : le staff l'a reçu.",
	"trop-tot": "Patiente quelques secondes avant de signaler un autre message.",
};

/**
 * « Signaler au staff », au clic droit sur un message (Applications).
 *
 * Ouvert a tout le monde : signaler ne demande aucun droit. La commande ne
 * peut pas differer sa reponse — `showModal` est refuse apres un accuse de
 * reception —, d'ou une capture en memoire et rien d'autre avant la modale.
 */
const command: MessageContextMenuCommand = {
	contextMenu: true,
	data: new ContextMenuCommandBuilder()
		.setName("Signaler au staff")
		.setType(ApplicationCommandType.Message),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;
		const message = interaction.targetMessage;

		const refus = refusDeSignalement(
			interaction.user.id,
			{
				id: message.id,
				authorId: message.author.id,
				authorIsSelf: message.author.id === interaction.client.user.id,
			},
			Date.now(),
		);
		if (refus) {
			await interaction.reply({ content: REFUS[refus], flags: MessageFlags.Ephemeral });
			return;
		}

		await interaction.showModal(modaleDeSignalement(capturer(message, interaction.user.id)));
	},
};

export = command;
