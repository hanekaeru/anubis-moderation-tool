const { Events, Collection, MessageFlags } = require('discord.js');
require('dotenv').config();

const commandCooldowns = new Collection();

module.exports = {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction, client) {
        if (!interaction.isChatInputCommand()) return;
        const command = interaction.client.commands.get(interaction.commandName);
        console.log(`[Interaction] User ${interaction.user.id} executed command ${interaction.commandName} in guild ${interaction.guildId}.`);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        // Si la commande a un cooldown, alors on applique la limite.
        if(command.cooldown) {
            if (!commandCooldowns.has(command.data.name)) {
                commandCooldowns.set(command.data.name, new Collection());
            }

            const now = Date.now();
            const timestamps = commandCooldowns.get(command.data.name);
            const cooldownAmount = command.cooldown * 1000;;

            if (timestamps.has(interaction.user.id)) {
                const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

                if (now < expirationTime) {
                    const expiredTimestamp = Math.round(expirationTime / 1000);
                    return interaction.reply({
                        content: `Please wait, you are on a cooldown for \`/${command.data.name}\`. You can use it again <t:${expiredTimestamp}:R>.`,
                        flags: MessageFlags.Ephemeral,
                    });
                }
            }

            timestamps.set(interaction.user.id, now);
            setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
        }

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            }
        }
    }
}

