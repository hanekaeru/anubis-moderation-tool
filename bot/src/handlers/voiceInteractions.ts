import {
	ActionRowBuilder,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextInputBuilder,
	TextInputStyle,
	parseEmoji,
	type ButtonInteraction,
	type ComponentEmojiResolvable,
	type ModalSubmitInteraction,
	type StringSelectMenuInteraction,
	type VoiceBasedChannel,
} from "discord.js";
import { VOICE_TEAM_ROLE_LABELS } from "@anubis/shared";
import type {
	TemporaryVoiceChannel,
	VoiceHub,
	VoiceHubPlatform,
	VoiceHubRank,
} from "@anubis/shared/prisma";
import prisma from "../prisma";
import * as voice from "../collectors/voice";
import * as voiceHubs from "../collectors/voiceHubs";
import * as voiceLog from "../collectors/voiceLog";
import {
	VOICE_CUSTOMIZE_MODAL,
	VOICE_DPS_INPUT,
	VOICE_KICK_SELECT,
	VOICE_PLATFORM_SELECT,
	VOICE_RANK_SELECT,
	VOICE_REPORT_INPUT,
	VOICE_REPORT_MODAL,
	VOICE_SUPPORT_INPUT,
	VOICE_TANK_INPUT,
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
	etat: { ownerId: string; locked: boolean; sujet: string },
): Promise<void> {
	await interaction.message
		.edit({
			embeds: [panelEmbed(etat)],
			components: [panelRow(etat.locked)],
		})
		.catch(() => undefined);
}

export async function handleVoicePanelButton(
	interaction: ButtonInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	// Une modale doit s'ouvrir sur une interaction encore vierge : Discord
	// refuse `showModal` apres un accuse de reception.
	if (
		interaction.customId === VoicePanelAction.CUSTOMIZE ||
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
		await rafraichirPanneau(interaction, {
			ownerId: temporaire.ownerId,
			locked: verrouille,
			sujet: await voiceHubs.sujetDuSalon(temporaire),
		});
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

/**
 * Emoji d'une option de rang ou de plateforme.
 *
 * Le dashboard laisse saisir aussi bien un emoji unicode qu'un emoji
 * personnalise sous la forme `<:nom:id>`. Discord n'accepte cette seconde
 * forme telle quelle que dans du texte : dans un composant, il lui faut
 * l'identifiant. `parseEmoji` fait la difference, et un champ vide reste vide.
 */
function emojiDOption(emoji: string | null): ComponentEmojiResolvable | undefined {
	if (!emoji) return undefined;

	const analyse = parseEmoji(emoji);
	if (!analyse?.name) return undefined;

	return analyse.id
		? { id: analyse.id, name: analyse.name, animated: analyse.animated }
		: { name: analyse.name };
}

function optionsDeChoix(
	entrees: { id: string; label: string; emoji: string | null }[],
	choisi: string | null,
): StringSelectMenuOptionBuilder[] {
	return entrees.map((entree) => {
		const option = new StringSelectMenuOptionBuilder()
			.setLabel(entree.label.slice(0, 100))
			.setValue(entree.id)
			.setDefault(entree.id === choisi);

		const emoji = emojiDOption(entree.emoji);
		if (emoji) option.setEmoji(emoji);

		return option;
	});
}

/** Champ « places prises » d'un role, avec son total en description. */
function champDeRole(
	customId: string,
	label: string,
	total: number,
	valeur: number | null,
): LabelBuilder {
	return new LabelBuilder()
		.setLabel(`${label} (sur ${total})`)
		.setTextInputComponent(
			new TextInputBuilder()
				.setCustomId(customId)
				.setStyle(TextInputStyle.Short)
				.setPlaceholder("0")
				.setMaxLength(2)
				.setRequired(false)
				.setValue(valeur === null ? "" : String(valeur)),
		);
}

/**
 * Modale de personnalisation du salon.
 *
 * Le nom n'y figure pas : il vient du gabarit du salon de creation et n'a
 * jamais a bouger. Le rang, la plateforme et les places composent le *sujet*
 * du salon, que Discord affiche sous son nom sans plafonner les changements —
 * la ou un renommage est limite a deux par dix minutes.
 *
 * Les deux selects sont facultatifs (`setRequired(false)`, `minValues` a 0) :
 * les vider est le seul moyen de retirer un rang deja pose, et un salon sans
 * rang retourne dans la categorie de son salon de creation.
 *
 * **Discord plafonne une modale a cinq champs.** Rang, plateforme et les trois
 * roles l'occupent entierement : c'est ce qui a fait sortir la limite de
 * places, qui se regle desormais par salon de creation depuis le dashboard.
 * Un role sans place dans la composition n'a pas de champ — demander « 0 sur
 * 0 » ne veut rien dire, et cela laisse de la place quand le serveur ne joue
 * pas avec les trois roles.
 */
function modaleDePersonnalisation(
	hub: VoiceHub,
	temporaire: TemporaryVoiceChannel,
	options: { ranks: VoiceHubRank[]; platforms: VoiceHubPlatform[] },
): ModalBuilder {
	const modale = new ModalBuilder()
		.setCustomId(VOICE_CUSTOMIZE_MODAL)
		.setTitle("Personnaliser le salon");

	if (options.ranks.length) {
		modale.addLabelComponents(
			new LabelBuilder()
				.setLabel("Rang")
				.setDescription("Range le salon dans la catégorie correspondante.")
				.setStringSelectMenuComponent(
					new StringSelectMenuBuilder()
						.setCustomId(VOICE_RANK_SELECT)
						.setPlaceholder("Aucun rang")
						.setMinValues(0)
						.setMaxValues(1)
						.setRequired(false)
						.addOptions(optionsDeChoix(options.ranks, temporaire.rankId)),
				),
		);
	}

	if (options.platforms.length) {
		modale.addLabelComponents(
			new LabelBuilder()
				.setLabel("Plateforme")
				.setStringSelectMenuComponent(
					new StringSelectMenuBuilder()
						.setCustomId(VOICE_PLATFORM_SELECT)
						.setPlaceholder("Aucune plateforme")
						.setMinValues(0)
						.setMaxValues(1)
						.setRequired(false)
						.addOptions(
							optionsDeChoix(options.platforms, temporaire.platformId),
						),
				),
		);
	}

	const roles: [string, string, number, number | null][] = [
		[VOICE_TANK_INPUT, VOICE_TEAM_ROLE_LABELS.tank, hub.tankSlots, temporaire.tankTaken],
		[VOICE_DPS_INPUT, VOICE_TEAM_ROLE_LABELS.dps, hub.dpsSlots, temporaire.dpsTaken],
		[
			VOICE_SUPPORT_INPUT,
			VOICE_TEAM_ROLE_LABELS.support,
			hub.supportSlots,
			temporaire.supportTaken,
		],
	];

	for (const [customId, label, total, valeur] of roles) {
		if (total > 0) modale.addLabelComponents(champDeRole(customId, label, total, valeur));
	}

	return modale;
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

	if (interaction.customId === VoicePanelAction.CUSTOMIZE) {
		// `showModal` est refuse apres un accuse de reception : la lecture du
		// salon de creation doit tenir dans les trois secondes de
		// l'interaction. Trois requetes indexees, comme pour `/preuve`.
		const [hub, options] = await Promise.all([
			prisma.voiceHub.findUnique({ where: { id: contexte.temporaire.hubId } }),
			voiceHubs.chargerOptions(contexte.temporaire.hubId),
		]);

		if (!hub) {
			await refuser(interaction, "Ce salon n'est plus géré par le bot.");
			return;
		}

		await interaction.showModal(
			modaleDePersonnalisation(hub, contexte.temporaire, options),
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

	const { salon, temporaire } = contexte;

	// Les deux selects ne sont dans la modale que si le salon de creation
	// propose des rangs : lire un champ absent leverait une erreur, la aussi
	// c'est la configuration du hub qui dit lesquels ont ete envoyes.
	const options = await voiceHubs.chargerOptions(temporaire.hubId);

	const rankId = options.ranks.length
		? (interaction.fields.getStringSelectValues(VOICE_RANK_SELECT)[0] ?? null)
		: temporaire.rankId;

	const platformId = options.platforms.length
		? (interaction.fields.getStringSelectValues(VOICE_PLATFORM_SELECT)[0] ?? null)
		: temporaire.platformId;

	const hub = await prisma.voiceHub.findUnique({ where: { id: temporaire.hubId } });
	if (!hub) {
		await refuser(interaction, "Ce salon n'est plus géré par le bot.");
		return;
	}

	const places = lirePlaces(interaction, hub);
	if ("erreur" in places) {
		await interaction.editReply({ content: places.erreur });
		return;
	}

	const resultat = await voiceHubs.appliquerPersonnalisation(salon, temporaire, {
		rankId,
		platformId,
		...places.valeurs,
	});

	await voiceLog.salonPersonnalise(
		interaction.guild,
		salon,
		interaction.user.id,
		resultat,
	);

	await rafraichirPanneauDepuisModale(interaction, {
		ownerId: temporaire.ownerId,
		locked: temporaire.locked,
		sujet: resultat.sujet,
	});

	// L'avertissement prime sur la confirmation : un rang refuse parce que sa
	// categorie est pleine laisse le reste des choix appliques, et le taire
	// ferait croire a un rangement qui n'a pas eu lieu.
	await interaction.editReply({
		content: resultat.avertissement
			? `Salon mis à jour, sauf le rang. ${resultat.avertissement}`
			: "Salon mis à jour.",
	});
}

/**
 * Places declarees dans la modale, ou le motif du refus.
 *
 * Trois regles, chacune pour une raison :
 * - un role absent de la composition n'a pas de champ : le lire leverait une
 *   erreur, c'est le salon de creation qui dit lesquels ont ete envoyes ;
 * - **tout vide vaut « rien a annoncer »** et efface la ligne des roles. C'est
 *   le seul chemin de retour vers un sujet sans composition, et il fallait
 *   qu'il existe — sinon le premier remplissage serait definitif ;
 * - une place au-dela du total est refusee plutot que ramenee au plafond :
 *   « 3 tanks sur 2 » est une faute de frappe, et la corriger en silence
 *   afficherait un chiffre que personne n'a saisi.
 */
export function lirePlaces(
	interaction: Pick<ModalSubmitInteraction, "fields">,
	hub: Pick<VoiceHub, "tankSlots" | "dpsSlots" | "supportSlots">,
):
	| { valeurs: { tankTaken: number | null; dpsTaken: number | null; supportTaken: number | null } }
	| { erreur: string } {
	const champs: [string, string, number][] = [
		[VOICE_TANK_INPUT, VOICE_TEAM_ROLE_LABELS.tank, hub.tankSlots],
		[VOICE_DPS_INPUT, VOICE_TEAM_ROLE_LABELS.dps, hub.dpsSlots],
		[VOICE_SUPPORT_INPUT, VOICE_TEAM_ROLE_LABELS.support, hub.supportSlots],
	];

	// Trois etats a distinguer, et ils ne donnent pas le meme resultat :
	// `undefined` = le role n'a pas de champ, `null` = champ laisse vide,
	// un nombre = place declaree.
	const lues: (number | null | undefined)[] = [];

	for (const [customId, label, total] of champs) {
		if (total <= 0) {
			lues.push(undefined);
			continue;
		}

		const brut = interaction.fields.getTextInputValue(customId).trim();
		if (!brut) {
			lues.push(null);
			continue;
		}

		const valeur = Number.parseInt(brut, 10);
		if (!/^\d+$/.test(brut) || Number.isNaN(valeur) || valeur > total) {
			return {
				erreur: `« ${label} » : indique un nombre entre 0 et ${total}.`,
			};
		}

		lues.push(valeur);
	}

	const [tank, dps, support] = lues;

	if (typeof tank !== "number" && typeof dps !== "number" && typeof support !== "number") {
		return { valeurs: { tankTaken: null, dpsTaken: null, supportTaken: null } };
	}

	// Un champ laisse vide a cote d'un autre rempli vaut zero : la ligne des
	// roles s'affiche en entier ou pas du tout. Un role que la composition ne
	// propose pas reste `null` : il n'a jamais ete declare.
	const declaree = (valeur: number | null | undefined) =>
		valeur === undefined ? null : (valeur ?? 0);

	return {
		valeurs: {
			tankTaken: declaree(tank),
			dpsTaken: declaree(dps),
			supportTaken: declaree(support),
		},
	};
}

/**
 * Remet le panneau en phase apres une modale.
 *
 * Une soumission de modale n'a pas de `message` : le panneau se retrouve par
 * le salon, ce qui suppose de le relire. Un panneau introuvable — efface a la
 * main — n'est pas une erreur : la personnalisation, elle, a bien eu lieu.
 */
async function rafraichirPanneauDepuisModale(
	interaction: ModalSubmitInteraction,
	etat: { ownerId: string; locked: boolean; sujet: string },
): Promise<void> {
	const salon = interaction.channel;
	if (!salon?.isVoiceBased()) return;

	// Le panneau est poste juste apres la creation du salon : le chercher
	// depuis le debut plutot que dans les derniers messages est ce qui le
	// retrouve encore dans un salon ou l'on a beaucoup parle.
	const messages = await salon.messages
		.fetch({ after: salon.id, limit: 5 })
		.catch(() => null);
	if (!messages) return;

	const panneau = messages.find(
		(message) =>
			message.author.id === interaction.client.user.id &&
			message.components.length > 0,
	);

	await panneau
		?.edit({ embeds: [panelEmbed(etat)], components: [panelRow(etat.locked)] })
		.catch(() => undefined);
}