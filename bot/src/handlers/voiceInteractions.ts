import {
	ActionRowBuilder,
	MessageFlags,
	ModalBuilder,
	StringSelectMenuBuilder,
	TextInputBuilder,
	TextInputStyle,
	type ButtonInteraction,
	type ModalSubmitInteraction,
	type StringSelectMenuInteraction,
	type VoiceBasedChannel,
} from "discord.js";
import type { TemporaryVoiceChannel } from "@anubis/shared/prisma";
import prisma from "../prisma";
import * as voice from "../collectors/voice";
import * as voiceHubs from "../collectors/voiceHubs";
import * as voiceLog from "../collectors/voiceLog";
import {
	VOICE_KICK_SELECT,
	VOICE_LIMIT_INPUT,
	VOICE_RENAME_INPUT,
	VOICE_RENAME_MODAL,
	VOICE_REPORT_INPUT,
	VOICE_REPORT_MODAL,
	VoicePanelAction,
	panelEmbed,
	panelRow,
} from "../utils/voicePanel";

/**
 * Panneau utilitaire des salons vocaux temporaires.
 *
 * Le salon d'ou vient l'interaction identifie la ligne : rien n'est encode
 * dans les `customId`, si bien qu'un changement de proprietaire n'oblige pas a
 * reposter le panneau.
 *
 * `deferReply` partout, jamais `deferUpdate` : le panneau reste affiche pour
 * tout le salon, et chaque clic merite sa propre reponse ephemere. Le
 * verrouillage est le seul a modifier le message d'origine, parce qu'il change
 * l'etat que ce message annonce.
 */

type VoiceInteraction =
	| ButtonInteraction
	| StringSelectMenuInteraction
	| ModalSubmitInteraction;

async function refuser(
	interaction: VoiceInteraction,
	message: string,
): Promise<void> {
	if (interaction.deferred || interaction.replied) {
		await interaction.editReply({ content: message, components: [] });
		return;
	}
	await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

/** Salon temporaire d'ou vient l'interaction, sans condition de propriete. */
async function contexteSalon(
	interaction: VoiceInteraction,
): Promise<{ salon: VoiceBasedChannel; temporaire: TemporaryVoiceChannel } | null> {
	if (!interaction.inCachedGuild()) return null;

	const salon = interaction.channel;
	if (!salon?.isVoiceBased()) {
		await refuser(
			interaction,
			"Ce panneau ne fonctionne que dans un salon vocal temporaire.",
		);
		return null;
	}

	const temporaire = await prisma.temporaryVoiceChannel.findFirst({
		where: { channelId: salon.id, closedAt: null },
	});

	if (!temporaire) {
		await refuser(interaction, "Ce salon n'est plus géré par le bot.");
		return null;
	}

	return { salon, temporaire };
}

/** Idem, mais reserve au proprietaire courant du salon. */
async function contexteProprietaire(
	interaction: VoiceInteraction,
): Promise<{ salon: VoiceBasedChannel; temporaire: TemporaryVoiceChannel } | null> {
	const contexte = await contexteSalon(interaction);
	if (!contexte) return null;

	if (contexte.temporaire.ownerId !== interaction.user.id) {
		await refuser(
			interaction,
			`Seul <@${contexte.temporaire.ownerId}>, propriétaire du salon, peut faire cela.`,
		);
		return null;
	}

	return contexte;
}

async function rafraichirPanneau(
	interaction: ButtonInteraction,
	ownerId: string,
	locked: boolean,
): Promise<void> {
	await interaction.message
		.edit({ embeds: [panelEmbed(ownerId, locked)], components: [panelRow(locked)] })
		.catch(() => undefined);
}

export async function handleVoicePanelButton(
	interaction: ButtonInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	// Une modale doit s'ouvrir sur une interaction encore vierge : Discord
	// refuse `showModal` apres un accuse de reception.
	if (
		interaction.customId === VoicePanelAction.RENAME ||
		interaction.customId === VoicePanelAction.REPORT
	) {
		await ouvrirModale(interaction);
		return;
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const contexte = await contexteProprietaire(interaction);
	if (!contexte) return;

	const { salon, temporaire } = contexte;

	if (interaction.customId === VoicePanelAction.LOCK) {
		const verrouille = !temporaire.locked;
		await voiceHubs.definirVerrou(salon, verrouille);
		await rafraichirPanneau(interaction, temporaire.ownerId, verrouille);
		await voiceLog.verrouChange(
			interaction.guild,
			salon,
			interaction.user.id,
			verrouille,
		);

		await interaction.editReply({
			content: verrouille
				? "Salon verrouillé : plus personne ne peut le rejoindre."
				: "Salon déverrouillé.",
		});
		return;
	}

	if (interaction.customId === VoicePanelAction.KICK) {
		const occupants = await voice.occupantsDuSalon(interaction.guildId, salon.id);
		const autres = occupants.filter(
			(occupant) => occupant.userId !== temporaire.ownerId,
		);

		if (!autres.length) {
			await interaction.editReply({ content: "Tu es seul dans ce salon." });
			return;
		}

		// 25 est le plafond d'options d'un select menu Discord ; au-dela, un
		// salon vocal aurait de toute facon deborde bien avant.
		const options = await Promise.all(
			autres.slice(0, 25).map(async (occupant) => {
				const membre = await interaction.guild.members
					.fetch(occupant.userId)
					.catch(() => null);
				return {
					label: membre?.displayName ?? occupant.userId,
					value: occupant.userId,
				};
			}),
		);

		const select = new StringSelectMenuBuilder()
			.setCustomId(VOICE_KICK_SELECT)
			.setPlaceholder("Choisis le membre à expulser")
			.addOptions(options);

		await interaction.editReply({
			content: "Qui souhaites-tu expulser de ce salon ?",
			components: [
				new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
			],
		});
	}
}

async function ouvrirModale(interaction: ButtonInteraction): Promise<void> {
	// Le signalement est ouvert a tous les occupants : reserve au
	// proprietaire, il ne servirait a rien dans le cas ou c'est justement lui
	// qui pose probleme.
	const contexte =
		interaction.customId === VoicePanelAction.REPORT
			? await contexteSalon(interaction)
			: await contexteProprietaire(interaction);
	if (!contexte) return;

	if (interaction.customId === VoicePanelAction.RENAME) {
		// Discord n'expose pas de description sur un salon vocal : le nom et la
		// limite de places sont les deux seuls reglages a offrir ici.
		const nom = new TextInputBuilder()
			.setCustomId(VOICE_RENAME_INPUT)
			.setLabel("Nom du salon")
			.setStyle(TextInputStyle.Short)
			.setMaxLength(100)
			.setRequired(true)
			.setValue(contexte.salon.name);

		const limite = new TextInputBuilder()
			.setCustomId(VOICE_LIMIT_INPUT)
			.setLabel("Places (0 = illimité)")
			.setStyle(TextInputStyle.Short)
			.setMaxLength(2)
			.setRequired(false)
			.setValue(String(contexte.salon.userLimit));

		await interaction.showModal(
			new ModalBuilder()
				.setCustomId(VOICE_RENAME_MODAL)
				.setTitle("Modifier le salon")
				.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(nom),
					new ActionRowBuilder<TextInputBuilder>().addComponents(limite),
				),
		);
		return;
	}

	const description = new TextInputBuilder()
		.setCustomId(VOICE_REPORT_INPUT)
		.setLabel("Que se passe-t-il ?")
		.setStyle(TextInputStyle.Paragraph)
		.setMaxLength(1000)
		.setRequired(true);

	await interaction.showModal(
		new ModalBuilder()
			.setCustomId(VOICE_REPORT_MODAL)
			.setTitle("Signaler un problème")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(description),
			),
	);
}

export async function handleVoiceKickSelect(
	interaction: StringSelectMenuInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const contexte = await contexteProprietaire(interaction);
	if (!contexte) return;

	const cibleId = interaction.values[0];
	if (!cibleId) return;

	const membre = await interaction.guild.members.fetch(cibleId).catch(() => null);

	// Deconnecte du vocal, pas expulse du serveur : c'est le verrou du panneau
	// qui empeche un retour immediat, pas une sanction.
	if (membre?.voice.channelId === contexte.salon.id) {
		await membre.voice.setChannel(null, "Expulsé du salon par son propriétaire.");
	}

	await voiceLog.membreExpulse(
		interaction.guild,
		contexte.salon,
		interaction.user.id,
		cibleId,
	);

	await interaction.editReply({
		content: `<@${cibleId}> a été déconnecté du salon.`,
		components: [],
	});
}

export async function handleVoiceModal(
	interaction: ModalSubmitInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	if (interaction.customId === VOICE_REPORT_MODAL) {
		const contexte = await contexteSalon(interaction);
		if (!contexte) return;

		await voiceLog.problemeSignale(
			interaction.guild,
			contexte.salon,
			interaction.user.id,
			interaction.fields.getTextInputValue(VOICE_REPORT_INPUT).trim(),
		);

		await interaction.editReply({
			content: "Signalement transmis à l'équipe de modération. Merci.",
		});
		return;
	}

	const contexte = await contexteProprietaire(interaction);
	if (!contexte) return;

	const { salon } = contexte;
	const ancienNom = salon.name;
	const nouveau = interaction.fields.getTextInputValue(VOICE_RENAME_INPUT).trim();

	if (!nouveau) {
		await interaction.editReply({ content: "Le nom ne peut pas être vide." });
		return;
	}

	const limiteBrute = interaction.fields
		.getTextInputValue(VOICE_LIMIT_INPUT)
		.trim();
	const limite = Number.parseInt(limiteBrute, 10);

	if (limiteBrute && (Number.isNaN(limite) || limite < 0 || limite > 99)) {
		await interaction.editReply({
			content: "La limite de places doit être un nombre entre 0 et 99.",
		});
		return;
	}

	await salon.setName(nouveau.slice(0, 100), "Modifié par le propriétaire.");
	if (limiteBrute) {
		await salon.setUserLimit(limite, "Modifié par le propriétaire.");
	}

	await prisma.temporaryVoiceChannel.updateMany({
		where: { channelId: salon.id, closedAt: null },
		data: { name: salon.name },
	});

	await voiceLog.salonRenomme(interaction.guild, salon, interaction.user.id, ancienNom);

	// Discord plafonne un salon a deux renommages par tranche de dix minutes :
	// au-dela, la requete reste en attente cote API au lieu d'echouer, ce que
	// le membre lirait comme un bug s'il n'etait pas prevenu.
	await interaction.editReply({
		content: `Salon mis à jour. Discord n'accepte que deux renommages par tranche de dix minutes.`,
	});
}
