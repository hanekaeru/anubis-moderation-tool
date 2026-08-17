import { MessageFlags, type ButtonInteraction } from "discord.js";
import * as referentiel from "../collectors/referentiel";
import * as quarantine from "../collectors/quarantine";

/** Identifiant du bouton pose par `/quarantaine-message`. */
export const QUARANTINE_ACCEPT_ID = "quarantine:accept";

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

	const messages: Record<typeof resultat, string> = {
		acceptee: "Merci ! Ton accès au serveur est ouvert.",
		"deja-acceptee": "Tu as déjà accepte le règlement.",
		"hors-service": "La quarantaine n'est pas active sur ce serveur.",
	};

	await interaction.editReply({ content: messages[resultat] });
}
