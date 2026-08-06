import { REST, Routes } from 'discord.js';
import { loadCommands } from './src/loadCommands';
import { requireEnv } from './src/env';

const commands = [...loadCommands().values()].map(command => command.data.toJSON());

const rest = new REST().setToken(requireEnv('BOT_TOKEN'));

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        const data = await rest.put(
            Routes.applicationGuildCommands(requireEnv('CLIENT_ID'), requireEnv('GUILD_HOST_ID')),
            { body: commands },
        );

        const count = Array.isArray(data) ? data.length : 0;
        console.log(`Successfully reloaded ${count} application (/) commands.`);
    } catch (error) {
        console.error(error);
    }
})();
