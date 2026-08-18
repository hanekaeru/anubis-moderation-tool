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
	CUSTOMIZE: "voice:customize",
	REPORT: "voice:report",
} as const;

/** Select menu d'expulsion, ouvert par le bouton correspondant. */
export const VOICE_KICK_SELECT = "voice:kick:select";

/** Modales de personnalisation et de signalement. */
export const VOICE_CUSTOMIZE_MODAL = "voice:customize:modal";
export const VOICE_RANK_SELECT = "rank";
export const VOICE_PLATFORM_SELECT = "platform";
export const VOICE_LIMIT_INPUT = "limit";
export const VOICE_TOPIC_INPUT = "topic";
export const VOICE_REPORT_MODAL = "voice:report:modal";
export const VOICE_REPORT_INPUT = "description";

/** Etat courant du salon, tel que le panneau l'annonce. */
export interface EtatPanneau {
	ownerId: string;
	locked: boolean;
	/** Sujet compose (rang, plateforme, texte libre), vide tant qu'aucun choix. */
	sujet?: string | null;
}

export function panelEmbed(etat: EtatPanneau): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(etat.locked ? colors.warning : colors.info)
		.setTitle("Gestion du salon")
		.setDescription(
			"Ce salon disparaîtra automatiquement une fois vide.\n" +
				"Les boutons ci-dessous sont réservés à son propriétaire.",
		)
		.addFields(
			{ name: "Propriétaire", value: `<@${etat.ownerId}>`, inline: true },
			{
				name: "État",
				value: etat.locked ? "🔒 Verrouillé" : "🔓 Ouvert",
				inline: true,
			},
		);

	// Le sujet est aussi affiche par Discord sous le nom du salon ; le
	// rappeler ici est ce qui permet au proprietaire de verifier ce que son
	// choix a produit sans quitter le panneau.
	if (etat.sujet) {
		embed.addFields({ name: "Sujet", value: etat.sujet.slice(0, 1024) });
	}

	return embed;
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
			.setCustomId(VoicePanelAction.CUSTOMIZE)
			.setLabel("Personnaliser")
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
		.send({
			embeds: [panelEmbed({ ownerId, locked: false })],
			components: [panelRow(false)],
		})
		.catch(() => undefined);
}
