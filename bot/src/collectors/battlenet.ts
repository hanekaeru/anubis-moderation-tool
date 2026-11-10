import { randomBytes } from "node:crypto";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type User,
} from "discord.js";
import {
	BATTLENET_LINK_COOLDOWN_SECONDS,
	BATTLENET_PRIVACY_NOTICE,
	BATTLENET_STATE_TTL_MINUTES,
} from "@anubis/shared";
import prisma from "../prisma";
import { lienVerificationBattlenet } from "../utils/verificationLink";
import * as referentiel from "./referentiel";

/**
 * Verification Battle.net cote bot : demande de lien.
 *
 * Un seul chemin pour le bouton du message de reglement et pour
 * `/lier_battlenet`. La deliaison, elle, vit dans `@anubis/shared/server`
 * (`unlinkBattlenet`), partagee avec le dashboard.
 *
 * Le role « BattleTag verifie » n'est jamais pose ni retire ici : il suit les
 * liens actifs en continu (`battlenetRole.ts`). Un seul endroit decide, et un
 * role pose ou retire a la main est corrige au passage suivant.
 */

/**
 * Base publique de l'API, telle que le navigateur d'un membre la voit. Le bot
 * n'appelle jamais l'API — il ne fait que composer un lien a cliquer.
 */
const PUBLIC_API_URL = process.env.PUBLIC_API_URL;

/**
 * Politique de confidentialite, hebergee hors du serveur. Facultative : sans
 * elle, le texte d'information part seul.
 */
const PRIVACY_POLICY_URL = process.env.PRIVACY_POLICY_URL?.trim();

/** Derniere demande de lien par membre, pour le delai entre deux demandes. */
const derniereDemande = new Map<string, number>();

/** Lien actif d'un membre, `null` sans (rien, ou seulement des traces). */
export function lienActif(userId: string) {
	return prisma.battlenetAccount.findFirst({
		where: { userId, unlinkedAt: null },
	});
}

/**
 * Information montree avant la connexion chez Blizzard, avec le lien vers la
 * politique de confidentialite quand il est renseigne.
 *
 * Le lien n'est accepte qu'en `https` vers un hote qui porte un point : une
 * variable mal renseignee ferait echouer l'envoi du message entier, au moment
 * ou un arrivant attend son lien.
 */
export function noticeConfidentialite(): string {
	const lien =
		PRIVACY_POLICY_URL && /^https:\/\/[^/\s]+\.[^/\s]+/.test(PRIVACY_POLICY_URL)
			? ` [Politique de confidentialité](<${PRIVACY_POLICY_URL}>)`
			: "";
	return `-# ${BATTLENET_PRIVACY_NOTICE}${lien}`;
}

export type DemandeVerification =
	| { kind: "deja-lie"; verifiedAt: Date }
	| { kind: "patienter"; secondes: number }
	| { kind: "indisponible" }
	| { kind: "lien"; url: string };

/**
 * Pose une demande de verification et rend le lien a cliquer.
 *
 * Le `state` est tire ici, au hasard cryptographique et jamais derive de
 * l'identifiant Discord — le callback etant une route publique, un `state`
 * devinable laisserait n'importe qui se verifier sans passer par Blizzard.
 *
 * Le delai entre deux demandes n'est pose qu'une fois un lien rendu : un
 * refus (deja lie, panne de configuration) n'a rien coute et ne doit pas
 * faire patienter.
 */
export async function demanderVerification(
	guildId: string,
	user: User,
): Promise<DemandeVerification> {
	const lien = await lienActif(user.id);
	if (lien) return { kind: "deja-lie", verifiedAt: lien.verifiedAt };

	const cle = `${guildId}:${user.id}`;
	const ecoule = Date.now() - (derniereDemande.get(cle) ?? 0);
	if (ecoule < BATTLENET_LINK_COOLDOWN_SECONDS * 1000) {
		return {
			kind: "patienter",
			secondes: Math.ceil((BATTLENET_LINK_COOLDOWN_SECONDS * 1000 - ecoule) / 1000),
		};
	}

	const state = randomBytes(32).toString("hex");
	const url = lienVerificationBattlenet(PUBLIC_API_URL, state);

	// Compose **avant** d'ecrire la demande : une base inutilisable ne doit pas
	// laisser derriere elle une ligne que personne n'ira jamais consommer.
	if (!url) {
		console.error(
			"[Battle.net] PUBLIC_API_URL inutilisable, lien de vérification non composé. " +
				`Valeur reçue : ${JSON.stringify(PUBLIC_API_URL)}. ` +
				"Attendu : l'URL publique de l'API, par exemple https://mon-domaine.fr/api",
		);
		return { kind: "indisponible" };
	}

	// `battlenet_verification_states` porte une cle etrangere vers
	// `discord_users` : le membre peut demander sans avoir ete vu par la
	// synchronisation.
	await referentiel.upsertUser(user);

	// Les demandes precedentes du meme membre sont marquees consommees : deux
	// liens valides en parallele n'apportent rien et allongent d'autant la
	// fenetre pendant laquelle un lien traine dans une conversation.
	await prisma.$transaction([
		prisma.battlenetVerificationState.updateMany({
			where: { guildId, userId: user.id, consumedAt: null },
			data: { consumedAt: new Date() },
		}),
		prisma.battlenetVerificationState.create({
			data: {
				state,
				guildId,
				userId: user.id,
				expiresAt: new Date(Date.now() + BATTLENET_STATE_TTL_MINUTES * 60_000),
			},
		}),
	]);

	derniereDemande.set(cle, Date.now());
	return { kind: "lien", url };
}

/**
 * Reponse ephemere qui accompagne le lien : l'information d'abord, le bouton
 * ensuite. Il ne vaut que pour la personne qui a demande, et un quart d'heure.
 */
export function messageLien(url: string) {
	return {
		content:
			"Clique sur le bouton ci-dessous pour te connecter à Battle.net. " +
			`Le lien n'est valable que ${BATTLENET_STATE_TTL_MINUTES} minutes et ne fonctionne que pour toi.\n` +
			noticeConfidentialite(),
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setLabel("Se connecter à Battle.net")
					.setStyle(ButtonStyle.Link)
					.setURL(url),
			),
		],
	};
}

/** Texte de refus commun au bouton et a `/lier_battlenet`. */
export function messageRefus(
	demande: Exclude<DemandeVerification, { kind: "lien" }>,
): string {
	switch (demande.kind) {
		case "deja-lie":
			return (
				`Ton compte Battle.net est déjà lié depuis le <t:${Math.floor(demande.verifiedAt.getTime() / 1000)}:D>. ` +
				"Utilise `/delier_battlenet` pour le délier."
			);
		case "patienter":
			return `Patiente encore ${demande.secondes} s avant de demander un nouveau lien.`;
		case "indisponible":
			return "La vérification n'est pas configurée sur ce serveur. Préviens l'équipe de modération.";
	}
}
