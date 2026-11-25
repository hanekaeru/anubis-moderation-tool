import type {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	Client,
	ClientEvents,
	Collection,
	ContextMenuCommandBuilder,
	MessageContextMenuCommandInteraction,
	SlashCommandBuilder,
	SlashCommandOptionsOnlyBuilder,
	SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export interface Command {
	// Ajouter une option (`.addUserOption`, `.addStringOption`, ...) fait
	// muter le type du builder vers `SlashCommandOptionsOnlyBuilder` — Discord
	// interdit de melanger options et sous-commandes sur une meme commande.
	data:
		| SlashCommandBuilder
		| SlashCommandOptionsOnlyBuilder
		| SlashCommandSubcommandsOnlyBuilder;
	execute(interaction: ChatInputCommandInteraction): Promise<void>;
	/**
	 * Suggestions d'une option declaree avec `setAutocomplete(true)`. Discord
	 * n'attend la reponse que trois secondes : rien d'autre qu'une recherche en
	 * memoire ne doit s'y faire.
	 */
	autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
	cooldown?: number;
	/**
	 * Commande de recette : ni chargee ni publiee aupres de Discord sans
	 * `MINIGAME_TEST_MODE=true`. Elle n'existe donc pas du tout en production,
	 * pas meme masquee derriere une permission.
	 */
	testOnly?: boolean;
}

/**
 * Commande de menu contextuel (clic droit > Applications), sur un message.
 *
 * Decouverte et publiee comme les commandes slash (`loadCommands`,
 * `refresh.ts`) ; `contextMenu` la distingue au routage, parce que Discord
 * range les deux dans le meme espace de noms mais pas avec la meme interaction.
 */
export interface MessageContextMenuCommand {
	contextMenu: true;
	data: ContextMenuCommandBuilder;
	execute(interaction: MessageContextMenuCommandInteraction): Promise<void>;
	testOnly?: boolean;
}

export type AnyCommand = Command | MessageContextMenuCommand;

export function estMenuContextuel(command: AnyCommand): command is MessageContextMenuCommand {
	return "contextMenu" in command && command.contextMenu === true;
}

/**
 * Le loader (`loadEvents.ts`) ajoute toujours `client` apres les arguments
 * natifs de l'evenement : `execute` en tient compte dans sa signature.
 */
export interface BotEvent<Key extends keyof ClientEvents = keyof ClientEvents> {
	name: Key;
	once?: boolean;
	execute(
		...args: [...ClientEvents[Key], client: Client]
	): Promise<void> | void;
}

declare module "discord.js" {
	interface Client {
		commands: Collection<string, AnyCommand>;
	}
}
