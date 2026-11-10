import { MessageFlags, type ButtonInteraction } from "discord.js";
import * as battlenet from "../collectors/battlenet";
import * as referentiel from "../collectors/referentiel";
import * as quarantine from "../collectors/quarantine";
import prisma from "../prisma";

/** Identifiant du bouton d'acceptation pose par `/quarantaine-message`. */
export const QUARANTINE_ACCEPT_ID = "quarantine:accept";

/** Identifiant du bouton de verification Battle.net du meme message. */
export const QUARANTINE_BATTLENET_ID = "quarantine:battlenet";

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
 * vers l'API, qui porte tout le protocole OAuth (`collectors/battlenet.ts`,
 * partage avec `/lier_battlenet`).
 *
 * Un membre qui a deja un lien actif — revenu sur le serveur, ou lie par
 * `/lier_battlenet` avant sa quarantaine — voit l'etape validee sans repasser
 * par Blizzard : le lien fait foi.
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

	const demande = await battlenet.demanderVerification(
		interaction.guildId,
		interaction.user,
	);

	if (demande.kind === "deja-lie") {
		const valide = await prisma.quarantineStatus.updateMany({
			where: {
				guildId: interaction.guildId,
				userId: interaction.user.id,
				battlenetVerifiedAt: null,
			},
			// `discordSyncedAt` a `null` : le rattrapage pose les roles de l'etape.
			data: { battlenetVerifiedAt: new Date(), discordSyncedAt: null },
		});

		await interaction.editReply({
			content:
				valide.count > 0
					? "Ton compte Battle.net est déjà lié : l'étape est validée."
					: "Ton compte Battle.net est déjà vérifié.",
		});
		return;
	}

	if (demande.kind !== "lien") {
		await interaction.editReply({ content: battlenet.messageRefus(demande) });
		return;
	}

	await interaction.editReply(battlenet.messageLien(demande.url));
}
