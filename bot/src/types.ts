import type {
    ChatInputCommandInteraction,
    Client,
    ClientEvents,
    Collection,
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder,
    SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';

export interface Command {
    // Ajouter une option (`.addUserOption`, `.addStringOption`, ...) fait
    // muter le type du builder vers `SlashCommandOptionsOnlyBuilder` — Discord
    // interdit de melanger options et sous-commandes sur une meme commande.
    data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
    execute(interaction: ChatInputCommandInteraction): Promise<void>;
    cooldown?: number;
}

/**
 * Le loader (`loadEvents.ts`) ajoute toujours `client` apres les arguments
 * natifs de l'evenement : `execute` en tient compte dans sa signature.
 */
export interface BotEvent<Key extends keyof ClientEvents = keyof ClientEvents> {
    name: Key;
    once?: boolean;
    execute(...args: [...ClientEvents[Key], client: Client]): Promise<void> | void;
}

declare module 'discord.js' {
    interface Client {
        commands: Collection<string, Command>;
    }
}
