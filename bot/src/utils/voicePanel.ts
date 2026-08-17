import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	type VoiceBasedChannel,
} from "discord.js";
import * as colors from "./constantes";

/**
 * Panneau utilitaire poste dans le chat textuel du salon vocal temporaire.
 *
 * Les identifiants ne portent aucune donnee : le salon d'ou vient le clic
 * suffit a retrouver la ligne `TemporaryVoiceChannel` et son proprietaire.
 * Encoder l'identifiant dans le `customId` obligerait a le revalider de toute
 * facon — le message, lui, survit a une reattribution de propriete.
 */

export const VOICE_PANEL_PREFIX = "voice:";

export const VoicePanelAction = {
	LOCK: "voice:lock",
	KICK: "voice:kick",
	RENAME: "voice:rename",
	REPORT: "voice:report",
} as const;

/** Select menu d'expulsion, ouvert par le bouton correspondant. */
export const VOICE_KICK_SELECT = "voice:kick:select";

/** Modales de modification et de signalement. */
export const VOICE_RENAME_MODAL = "voice:rename:modal";
export const VOICE_RENAME_INPUT = "name";
export const VOICE_LIMIT_INPUT = "limit";
export const VOICE_REPORT_MODAL = "voice:report:modal";
export const VOICE_REPORT_INPUT = "description";

export function panelEmbed(ownerId: string, locked: boolean): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(locked ? colors.warning : colors.info)
		.setTitle("Gestion du salon")
		.setDescription(
			"Ce salon disparaîtra automatiquement une fois vide.\n" +
				"Les boutons ci-dessous sont réservés à son propriétaire.",
		)
		.addFields(
			{ name: "Propriétaire", value: `<@${ownerId}>`, inline: true },
			{ name: "État", value: locked ? "🔒 Verrouillé" : "🔓 Ouvert", inline: true },
		);
}

export function panelRow(locked: boolean): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(VoicePanelAction.LOCK)
			.setLabel(locked ? "Déverrouiller" : "Verrouiller")
			.setEmoji(locked ? "🔓" : "🔒")
			.setStyle(locked ? ButtonStyle.Success : ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId(VoicePanelAction.KICK)
			.setLabel("Expulser")
			.setEmoji("👢")
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId(VoicePanelAction.RENAME)
			.setLabel("Renommer")
			.setEmoji("✏️")
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId(VoicePanelAction.REPORT)
			.setLabel("Signaler un problème")
			.setEmoji("🚩")
			.setStyle(ButtonStyle.Danger),
	);
}

/** Poste le panneau dans le chat integre du salon vocal. */
export async function posterPanneau(
	salon: VoiceBasedChannel,
	ownerId: string,
): Promise<void> {
	await salon
		.send({ embeds: [panelEmbed(ownerId, false)], components: [panelRow(false)] })
		.catch(() => undefined);
}
