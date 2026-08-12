import { REST, Routes } from "discord.js";
import { requireEnv } from "./src/env";

const commandIdToDelete = process.argv[2];

if (!commandIdToDelete) {
	console.error("Usage : npm run delete -- <commandId>");
	process.exit(1);
}

const rest = new REST().setToken(requireEnv("BOT_TOKEN"));

rest.delete(
	Routes.applicationGuildCommand(
		requireEnv("CLIENT_ID"),
		requireEnv("GUILD_HOST_ID"),
		commandIdToDelete,
	),
)
	.then(() =>
		console.log(`Successfully deleted ${commandIdToDelete} guild command!`),
	)
	.catch(console.error);

rest.delete(
	Routes.applicationCommand(requireEnv("CLIENT_ID"), commandIdToDelete),
)
	.then(() =>
		console.log(
			`Successfully deleted ${commandIdToDelete} application command`,
		),
	)
	.catch(console.error);
