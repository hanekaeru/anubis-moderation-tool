import {
	Collection,
	DiscordAPIError,
	Events,
	type Interaction,
	MessageFlags,
	RESTJSONErrorCodes,
} from "discord.js";

/**
 * Discord ne laisse que **trois secondes** pour accuser reception d'une
 * commande. Passe ce delai, il repond « Unknown interaction » (10062) au
 * `deferReply` — et la reponse d'erreur echoue de la meme facon, ce qui
 * remontait en second plantage dans « Erreur du client ».
 *
 * Le message dit lequel des deux cas s'est produit, parce qu'ils ne se
 * corrigent pas pareil : une interaction **recue** deja vieille signale un bot
 * occupe (demarrage, synchronisation complete) ; une interaction recue a temps
 * mais refusee quand meme signale une autre instance du bot sur le meme jeton,
 * qui a repondu la premiere.
 */
function interactionPerdue(error: unknown): boolean {
	return (
		error instanceof DiscordAPIError &&
		(error.code === RESTJSONErrorCodes.UnknownInteraction ||
			error.code === RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged)
	);
}

function signalerInteractionPerdue(interaction: Interaction, recueA: number, error: DiscordAPIError): void {
	const ageALaReception = recueA - interaction.createdTimestamp;
	const cause =
		ageALaReception > 2_500
			? "le bot l'a reçue trop tard : il était occupé (démarrage, synchronisation complète ?)."
			: "reçue à temps, donc une autre instance du bot tourne probablement avec le même jeton et a répondu la première.";
	console.error(
		`[Interaction] '${"commandName" in interaction ? interaction.commandName : interaction.id}' expirée (code ${error.code}) : ` +
			`reçue ${ageALaReception} ms après sa création, refusée ${Date.now() - recueA} ms plus tard — ${cause}`,
	);
}
import {
	EVIDENCE_MODAL_PREFIX,
	handleEvidenceModal,
} from "../handlers/evidenceInteractions";
import { handleLeaderboardButton } from "../handlers/leaderboardInteractions";
import { handleReportModal, handleReportWhoisButton } from "../handlers/reportInteractions";
import { handleLfgClose } from "../handlers/lfgInteractions";
import { LFG_CLOSE_PREFIX } from "../collectors/lfg";
import { REPORT_MODAL_PREFIX, REPORT_WHOIS_PREFIX } from "../collectors/reports";
import {
	QUARANTINE_ACCEPT_ID,
	QUARANTINE_BATTLENET_ID,
	handleQuarantineAccept,
	handleQuarantineBattlenet,
} from "../handlers/quarantineInteractions";
import {
	TICKET_OPEN_BUTTON,
	TICKET_OPEN_MODAL,
	handleTicketButton,
	handleTicketOpenButton,
	handleTicketOpenModal,
} from "../handlers/ticketInteractions";
import {
	handleVoiceKickSelect,
	handleVoiceModal,
	handleVoicePanelButton,
} from "../handlers/voiceInteractions";
import { estMenuContextuel, type BotEvent } from "../types";
import {
	VOICE_KICK_SELECT,
	VOICE_PANEL_PREFIX,
	VOICE_CUSTOMIZE_MODAL,
	VOICE_REPORT_MODAL,
} from "../utils/voicePanel";
import { LEADERBOARD_BUTTON_PREFIX } from "../utils/xpEmbeds";

/**
 * Routage des interactions de composants (boutons, menus, modales).
 *
 * Une table plutot qu'une suite de `if` : les huit branches ne differaient que
 * par leur condition, leur handler et leur message d'erreur. **L'ordre compte**
 * — la premiere route qui accepte l'emporte, et certains identifiants exacts
 * partagent le prefixe d'une route plus large (`VOICE_KICK_SELECT` commence par
 * `VOICE_PANEL_PREFIX`). Toute route a identifiant exact doit donc rester
 * au-dessus de la route a prefixe qui la contient.
 */
interface Route {
	accepte(interaction: Interaction): boolean;
	traite(interaction: Interaction): Promise<void>;
	erreur: string;
}

/**
 * Chaque handler attend un type d'interaction different, que seul `accepte`
 * garantit. TypeScript ne peut pas suivre ce lien a travers un tableau
 * heterogene : la conversion est donc **confinee ici**, une seule fois, plutot
 * que repetee a chaque route. `T` reste deduit du handler passe, ce qui laisse
 * chaque `traite` type precisement a la construction.
 */
function route<T extends Interaction>(
	accepte: (interaction: Interaction) => boolean,
	traite: (interaction: T) => Promise<void>,
	erreur: string,
): Route {
	return { accepte, traite: (interaction) => traite(interaction as T), erreur };
}

const ROUTES: readonly Route[] = [
	// Declare avant la route generique `ticket:` : le bouton d'ouverture porte
	// lui aussi ce prefixe, et partirait sinon vers le panneau de controle.
	route(
		(i) => i.isButton() && i.customId === TICKET_OPEN_BUTTON,
		handleTicketOpenButton,
		"[Tickets] Ouverture depuis le panneau échouée :",
	),
	route(
		(i) => i.isModalSubmit() && i.customId === TICKET_OPEN_MODAL,
		handleTicketOpenModal,
		"[Tickets] Formulaire d'ouverture échoué :",
	),
	route(
		(i) =>
			i.isModalSubmit() &&
			(i.customId === VOICE_CUSTOMIZE_MODAL || i.customId === VOICE_REPORT_MODAL),
		handleVoiceModal,
		"[Vocaux] Formulaire du panneau échoué :",
	),
	route(
		(i) => i.isModalSubmit() && i.customId.startsWith(EVIDENCE_MODAL_PREFIX),
		handleEvidenceModal,
		"[Preuves] Dépôt depuis la modale échoué :",
	),
	route(
		(i) => i.isModalSubmit() && i.customId.startsWith(REPORT_MODAL_PREFIX),
		handleReportModal,
		"[Signalements] Envoi du signalement échoué :",
	),
	route(
		(i) => i.isButton() && i.customId.startsWith(REPORT_WHOIS_PREFIX),
		handleReportWhoisButton,
		"[Signalements] Ouverture d'une fiche échouée :",
	),
	route(
		(i) => i.isButton() && i.customId.startsWith(LFG_CLOSE_PREFIX),
		handleLfgClose,
		"[LFG] Fermeture de l'annonce échouée :",
	),
	route(
		(i) => i.isStringSelectMenu() && i.customId === VOICE_KICK_SELECT,
		handleVoiceKickSelect,
		"[Vocaux] Expulsion depuis le panneau échouée :",
	),
	route(
		(i) => i.isButton() && i.customId.startsWith(VOICE_PANEL_PREFIX),
		handleVoicePanelButton,
		"[Vocaux] Action du panneau échouée :",
	),
	route(
		(i) => i.isButton() && i.customId.startsWith(LEADERBOARD_BUTTON_PREFIX),
		handleLeaderboardButton,
		"[XP] Pagination du classement échouée :",
	),
	route(
		(i) => i.isButton() && i.customId === QUARANTINE_ACCEPT_ID,
		handleQuarantineAccept,
		"[Quarantaine] Acceptation du règlement échouée :",
	),
	route(
		(i) => i.isButton() && i.customId === QUARANTINE_BATTLENET_ID,
		handleQuarantineBattlenet,
		"[Quarantaine] Vérification Battle.net échouée :",
	),
	route(
		(i) => i.isButton() && i.customId.startsWith("ticket:"),
		handleTicketButton,
		"[Tickets] Action sur bouton échouée :",
	),
];

/** Horodatage du dernier appel, par commande puis par utilisateur. */
const commandCooldowns = new Collection<string, Collection<string, number>>();

/**
 * Renvoie la fin du cooldown si l'utilisateur doit encore patienter, sinon
 * enregistre l'appel et renvoie `null`.
 */
function verifierCooldown(
	nom: string,
	userId: string,
	secondes: number,
): number | null {
	if (!commandCooldowns.has(nom)) commandCooldowns.set(nom, new Collection());
	const horodatages = commandCooldowns.get(nom)!;

	const maintenant = Date.now();
	const duree = secondes * 1000;
	const precedent = horodatages.get(userId);

	if (precedent !== undefined && maintenant < precedent + duree) {
		return precedent + duree;
	}

	horodatages.set(userId, maintenant);
	// Le nettoyage evite que la collection grossisse indefiniment sur un gros
	// serveur : passe le cooldown, l'entree n'apprend plus rien.
	setTimeout(() => horodatages.delete(userId), duree);
	return null;
}

const event: BotEvent<typeof Events.InteractionCreate> = {
	name: Events.InteractionCreate,
	once: false,
	async execute(interaction) {
		// Avant tout `await` : c'est l'heure d'arrivee qui dit si le bot etait en retard.
		const recueA = Date.now();
		for (const route of ROUTES) {
			if (!route.accepte(interaction)) continue;
			try {
				await route.traite(interaction);
			} catch (err) {
				console.error(route.erreur, err);
			}
			return;
		}

		if (interaction.isAutocomplete()) {
			// Pas de cooldown ici : Discord envoie une requete a chaque frappe.
			const command = interaction.client.commands.get(interaction.commandName);
			if (!command || estMenuContextuel(command)) return;
			try {
				await command.autocomplete?.(interaction);
			} catch (err) {
				console.error(`[Interaction] Autocomplétion de '${interaction.commandName}' échouée :`, err);
			}
			return;
		}

		if (interaction.isMessageContextMenuCommand()) {
			const command = interaction.client.commands.get(interaction.commandName);
			if (!command || !estMenuContextuel(command)) {
				console.error(`[Interaction] Aucun menu contextuel ne correspond à '${interaction.commandName}'.`);
				return;
			}
			try {
				await command.execute(interaction);
			} catch (error) {
				if (interactionPerdue(error)) {
					signalerInteractionPerdue(interaction, recueA, error as DiscordAPIError);
					return;
				}
				console.error(`[Interaction] Menu contextuel '${interaction.commandName}' échoué :`, error);
			}
			return;
		}

		if (!interaction.isChatInputCommand()) return;
		if (interaction.replied || interaction.deferred) return;

		const found = interaction.client.commands.get(interaction.commandName);
		// Un menu contextuel ne partage que son nom avec les commandes slash.
		const command = found && !estMenuContextuel(found) ? found : undefined;
		console.log(
			`[Interaction] <${interaction.user.id}> a lancé '${interaction.commandName}' sur le serveur ${interaction.guildId}.`,
		);

		if (!command) {
			console.error(
				`[Interaction] Aucune commande ne correspond à '${interaction.commandName}'.`,
			);
			return;
		}

		if (command.cooldown) {
			const fin = verifierCooldown(
				command.data.name,
				interaction.user.id,
				command.cooldown,
			);
			if (fin !== null) {
				await interaction.reply({
					content: `Patiente un peu : \`/${command.data.name}\` sera de nouveau disponible <t:${Math.round(fin / 1000)}:R>.`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
		}

		try {
			await command.execute(interaction);
		} catch (error) {
			// Rien a repondre : l'interaction n'existe plus pour Discord, et la
			// reponse d'erreur echouerait a son tour.
			if (interactionPerdue(error)) {
				signalerInteractionPerdue(interaction, recueA, error as DiscordAPIError);
				return;
			}
			console.error(
				`[Interaction] '${interaction.commandName}' a échoué :`,
				error,
			);
			const reponse = {
				content: "Une erreur est survenue pendant l'exécution de la commande.",
				flags: MessageFlags.Ephemeral,
			} as const;
			// `followUp` si la commande a deja repondu ou differe : `reply` serait
			// alors refuse par Discord.
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp(reponse);
			} else {
				await interaction.reply(reponse);
			}
		}
	},
};

export = event;
