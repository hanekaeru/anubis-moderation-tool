import fs from "node:fs";
import path from "node:path";
import { Collection } from "discord.js";
import type { Command } from "./types";

const COMMANDS_DIR = path.join(__dirname, "commands");

function isCommandModule(value: unknown): value is Command {
	return (
		typeof value === "object" &&
		value !== null &&
		"data" in value &&
		"execute" in value
	);
}

/**
 * Decouvre les commandes dans `commands/<categorie>/*.ts` (ou `.js` une fois
 * compile en `dist/`). Partage par `index.ts` (enregistrement local) et
 * `refresh.ts` (publication aupres de l'API Discord) — les deux devaient
 * dupliquer cette boucle avant.
 */
export function loadCommands(): Collection<string, Command> {
	const commands = new Collection<string, Command>();
	const commandFolders = fs.readdirSync(COMMANDS_DIR);

	for (const folder of commandFolders) {
		const commandsPath = path.join(COMMANDS_DIR, folder);
		const commandFiles = fs
			.readdirSync(commandsPath)
			.filter((file) => file.endsWith(".ts") || file.endsWith(".js"));

		for (const file of commandFiles) {
			const filePath = path.join(commandsPath, file);
			const command: unknown = require(filePath);

			if (isCommandModule(command)) {
				commands.set(command.data.name, command);
			} else {
				console.log(
					`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
				);
			}
		}
	}

	return commands;
}
