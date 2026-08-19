import { randomBytes } from "node:crypto";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	type ButtonInteraction,
} from "discord.js";
import { BATTLENET_STATE_TTL_MINUTES } from "@anubis/shared";
import * as referentiel from "../collectors/referentiel";
import { lienVerificationBattlenet } from "../utils/verificationLink";
import * as quarantine from "../collectors/quarantine";
import prisma from "../prisma";

/** Identifiant du bouton d'acceptation pose par `/quarantaine-message`. */
export const QUARANTINE_ACCEPT_ID = "quarantine:accept";

/** Identifiant du bouton de verification Battle.net du meme message. */
export const QUARANTINE_BATTLENET_ID = "quarantine:battlenet";

/**
 * Base publique de l'API, telle que le navigateur d'un membre la voit.
 *
 * Le bot n'appelle jamais l'API — il ne fait que composer un lien a cliquer. La
 * variable est donc l'URL exterieure (celle servie par le proxy), pas l'adresse
 * interne du conteneur.
 *
 * Elle n'est **pas** validee ici mais a chaque composition : une base absurde
 * (`https://${APP_DOMAIN}/api` non substituee) doit produire un message clair
 * dans le journal, pas un `DiscordAPIError[50035]` muet sur la valeur en cause.
 */
const PUBLIC_API_URL = process.env.PUBLIC_API_URL;

/**
 * Clic sur « J'accepte le reglement ».
 *
 * `deferReply` et non `deferUpdate`, a la difference du panneau de tickets : ce
 * bouton ne modifie pas le message d'origine, qui reste affiche pour les
 * prochains arrivants. Il n'y a donc aucun etat a reinitialiser dessus, et
 * chaque membre doit recevoir sa propre reponse ephemere.
 */
export async function handleQuarantineAccept(
	interaction: ButtonInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	// `quarantine_status` porte une cle etrangere vers `discord_users` : le
	// membre peut cliquer sans avoir ete vu par la synchronisation.
	await referentiel.upsertUser(interaction.user);

	const resultat = await quarantine.accepterReglement(interaction.member);

	const config = await prisma.quarantineConfig.findUnique({
		where: { guildId: interaction.guildId },
		select: { battlenetRequired: true },
	});

	// Le message d'acceptation ne doit pas annoncer un acces ouvert quand une
	// seconde etape attend encore : l'arrivant chercherait des salons qu'il ne
	// voit pas et conclurait a une panne.
	const suite =
		config?.battlenetRequired && resultat === "acceptee"
			? "Merci ! Il te reste à vérifier ton compte Battle.net avec le second bouton pour ouvrir l'accès au serveur."
			: "Merci ! Ton accès au serveur est ouvert.";

	const messages: Record<typeof resultat, string> = {
		acceptee: suite,
		"deja-acceptee": "Tu as déjà accepté le règlement.",
		"hors-service": "La quarantaine n'est pas active sur ce serveur.",
	};

	await interaction.editReply({ content: messages[resultat] });
}

/**
 * Clic sur « Vérifier mon compte Battle.net ».
 *
 * Le bot ne parle pas a Blizzard : il pose une demande en base et rend un lien
 * vers l'API, qui porte tout le protocole OAuth. Le `state` est tire ici, au
 * hasard cryptographique et jamais derive de l'identifiant Discord — le
 * callback etant une route publique, un `state` devinable laisserait n'importe
 * qui se verifier sans passer par Blizzard.
 *
 * Le lien part en message ephemere plutot que dans le message de reglement :
 * il ne vaut que pour la personne qui a clique, et pour un quart d'heure.
 */
export async function handleQuarantineBattlenet(
	interaction: ButtonInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const config = await prisma.quarantineConfig.findUnique({
		where: { guildId: interaction.guildId },
	});

	if (!config?.enabled || !config.battlenetRequired) {
		await interaction.editReply({
			content: "La vérification Battle.net n'est pas demandée sur ce serveur.",
		});
		return;
	}

	await referentiel.upsertUser(interaction.user);

	const statut = await prisma.quarantineStatus.findUnique({
		where: {
			guildId_userId: {
				guildId: interaction.guildId,
				userId: interaction.user.id,
			},
		},
	});

	if (statut?.battlenetVerifiedAt) {
		await interaction.editReply({
			content: "Ton compte Battle.net est déjà vérifié.",
		});
		return;
	}

	const state = randomBytes(32).toString("hex");
	const lien = lienVerificationBattlenet(PUBLIC_API_URL, state);

	// Compose **avant** d'ecrire la demande : une base inutilisable ne doit pas
	// laisser derriere elle une ligne de `battlenet_verification_states` que
	// personne n'ira jamais consommer.
	if (!lien) {
		console.error(
			"[Quarantaine] PUBLIC_API_URL inutilisable, lien de vérification non composé. " +
				`Valeur reçue : ${JSON.stringify(PUBLIC_API_URL)}. ` +
				"Attendu : l'URL publique de l'API, par exemple https://mon-domaine.fr/api",
		);
		await interaction.editReply({
			content:
				"La vérification n'est pas configurée sur ce serveur. Préviens l'équipe de modération.",
		});
		return;
	}

	// Les demandes precedentes du meme membre sont marquees consommees : deux
	// liens valides en parallele n'apportent rien et allongent d'autant la
	// fenetre pendant laquelle un lien traine dans une conversation.
	await prisma.$transaction([
		prisma.battlenetVerificationState.updateMany({
			where: {
				guildId: interaction.guildId,
				userId: interaction.user.id,
				consumedAt: null,
			},
			data: { consumedAt: new Date() },
		}),
		prisma.battlenetVerificationState.create({
			data: {
				state,
				guildId: interaction.guildId,
				userId: interaction.user.id,
				expiresAt: new Date(
					Date.now() + BATTLENET_STATE_TTL_MINUTES * 60_000,
				),
			},
		}),
	]);

	await interaction.editReply({
		content:
			`Clique sur le bouton ci-dessous pour te connecter à Battle.net. ` +
			`Le lien n'est valable que ${BATTLENET_STATE_TTL_MINUTES} minutes et ne fonctionne que pour toi.`,
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setLabel("Se connecter à Battle.net")
					.setStyle(ButtonStyle.Link)
					.setURL(lien),
			),
		],
	});
}
