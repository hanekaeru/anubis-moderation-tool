const { REST, Routes } = require('discord.js');
require('dotenv').config();

const rest = new REST().setToken(process.env.BOT_TOKEN);

var commandIdToDelete = "";

rest.delete(Routes.applicationGuildCommand(process.env.CLIENT_ID, process.env.GUILD_HOST_ID, commandIdToDelete))
	.then(() => console.log(`Successfully deleted ${commandIdToDelete} guild command!`))
	.catch(console.error);

rest.delete(Routes.applicationCommand(process.env.CLIENT_ID, commandIdToDelete))
	.then(() => console.log(`Successfully deleted ${commandIdToDelete} application command`))
	.catch(console.error);