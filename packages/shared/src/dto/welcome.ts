import { IsoDateString, Snowflake } from "./common";

/**
 * Messages automatiques d'arrivee, de depart et de boost.
 *
 * L'annonce de boost interpelle la moderation : le role de boost, gere par
 * Discord, n'ouvre volontairement rien ; c'est un role bonus pose a la main qui
 * donne acces aux salons reserves. Sans cette annonce, le staff ne saurait pas
 * qu'il a un role a donner — et c'est en le donnant lui-meme qu'il verifie que
 * le membre a bien passe la quarantaine.
 */

export interface WelcomeConfigDto {
	guildId: Snowflake;
	/** Salon des arrivees et des departs. */
	channelId: Snowflake | null;
	joinEnabled: boolean;
	/** Gabarit personnalise, `null` pour le texte par defaut. */
	joinMessage: string | null;
	leaveEnabled: boolean;
	leaveMessage: string | null;
	boostEnabled: boolean;
	/** Salon des annonces de boost, `null` pour celui des arrivees. */
	boostChannelId: Snowflake | null;
	boostMessage: string | null;
	/**
	 * Role que `{moderation}` interpelle : celui choisi dans « Rôles & mentions ».
	 * En lecture seule ici ; `null` quand aucun n'est choisi, et l'annonce de
	 * boost n'interpelle alors personne.
	 */
	alertRoleId: Snowflake | null;
	updatedAt: IsoDateString | null;
}

export interface UpdateWelcomeConfigRequest {
	channelId?: Snowflake | null;
	joinEnabled?: boolean;
	joinMessage?: string | null;
	leaveEnabled?: boolean;
	leaveMessage?: string | null;
	boostEnabled?: boolean;
	boostChannelId?: Snowflake | null;
	boostMessage?: string | null;
}

export const WelcomeEvent = {
	JOIN: "JOIN",
	LEAVE: "LEAVE",
	BOOST: "BOOST",
} as const;
export type WelcomeEvent = (typeof WelcomeEvent)[keyof typeof WelcomeEvent];

/** Un message plus long serait refuse par Discord une fois les jetons rendus. */
export const MAX_WELCOME_MESSAGE_LENGTH = 1000;

export const DEFAULT_WELCOME_MESSAGES: Record<WelcomeEvent, string> = {
	JOIN: "👋 Bienvenue {membre} sur **{serveur}** ! Nous sommes maintenant {membres}.",
	LEAVE: "🚪 **{pseudo}** a quitté le serveur. Nous sommes maintenant {membres}.",
	BOOST:
		"💎 {membre} vient de booster **{serveur}**, merci ! ({boosts} boosts) {moderation}",
};

/** Jetons reconnus, listes avec un exemple de rendu sous chaque champ. */
export const WELCOME_PLACEHOLDERS: Record<
	WelcomeEvent,
	readonly { token: string; label: string }[]
> = {
	JOIN: [
		{ token: "{membre}", label: "Mention du membre" },
		{ token: "{pseudo}", label: "Nom affiché, sans mention" },
		{ token: "{serveur}", label: "Nom du serveur" },
		{ token: "{membres}", label: "Nombre de membres" },
	],
	// Pas de `{membre}` : la mention d'un compte parti ne s'affiche plus que
	// comme un identifiant chez la plupart des lecteurs.
	LEAVE: [
		{ token: "{pseudo}", label: "Nom affiché" },
		{ token: "{serveur}", label: "Nom du serveur" },
		{ token: "{membres}", label: "Nombre de membres" },
	],
	BOOST: [
		{ token: "{membre}", label: "Mention du membre" },
		{ token: "{pseudo}", label: "Nom affiché, sans mention" },
		{ token: "{serveur}", label: "Nom du serveur" },
		{ token: "{boosts}", label: "Nombre total de boosts" },
		{ token: "{moderation}", label: "Mention du rôle d'alerte (notifie l'équipe)" },
	],
};

export interface WelcomeMessageContext {
	userId: Snowflake;
	/** Nom affiche, deja echappe pour le Markdown de Discord par l'appelant. */
	displayName: string;
	guildName: string;
	memberCount: number;
	boostCount?: number;
	/** Role interpelle par `{moderation}` ; `null` rend le jeton vide. */
	alertRoleId?: Snowflake | null;
}

/**
 * Rend un gabarit d'arrivee, de depart ou de boost.
 *
 * Partage entre le bot (qui envoie) et le dashboard (qui previsualise), meme
 * raison que `renderXpLevelUpMessage` : deux rendus finiraient par diverger.
 *
 * `{moderation}` sans role choisi rend une chaine vide plutot qu'un texte du
 * genre « @rôle-inconnu » : le message reste lisible, et le dashboard signale
 * l'absence de role a cote du reglage. Les espaces doubles qu'il laisserait
 * sont resserres.
 */
export function renderWelcomeMessage(
	template: string,
	context: WelcomeMessageContext,
): string {
	return template
		.replaceAll("{membre}", `<@${context.userId}>`)
		.replaceAll("{pseudo}", context.displayName)
		.replaceAll("{serveur}", context.guildName)
		.replaceAll("{membres}", String(context.memberCount))
		.replaceAll("{boosts}", String(context.boostCount ?? 0))
		.replaceAll(
			"{moderation}",
			context.alertRoleId ? `<@&${context.alertRoleId}>` : "",
		)
		.replace(/ {2,}/g, " ")
		.trim();
}
