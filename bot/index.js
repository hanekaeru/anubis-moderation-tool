const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');

const prisma = require('./src/prisma');
const activite = require('./src/collectors/activite');
const xpManager = require('./src/collectors/xp');

require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        // Intent privilegie : a activer dans le portail developpeur Discord
        // (Bot > Privileged Gateway Intents > Server Members Intent). Sans lui,
        // la connexion echoue et ni la liste des membres ni l'historique des
        // roles ne peuvent etre alimentes.
        GatewayIntentBits.GuildMembers,
    ]
});

client.commands = new Collection();
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);
	const event = require(filePath);
	if (event.once) {
		client.once(event.name, (...args) => event.execute(...args, client));
	} else {
		client.on(event.name, (...args) => event.execute(...args, client));
	}
}

client.on(Events.Error, (error) => {
    console.error('[Discord] Erreur du client :', error);
});

/**
 * Arret propre.
 *
 * L'XP et les statistiques d'activite vivent en memoire entre deux vidages :
 * quitter sans les ecrire perdrait tout ce qui a ete accumule depuis le dernier
 * flush, soit jusqu'a une quinzaine de secondes d'activite.
 */
let arretEnCours = false;

async function arreter(signal) {
    if (arretEnCours) return;
    arretEnCours = true;

    console.log(`[Bot] ${signal} recu, vidage des buffers avant l'arret...`);

    try {
        await Promise.allSettled([xpManager.flush(), activite.vider()]);
    } catch (err) {
        console.error('[Bot] Vidage incomplet :', err);
    }

    await client.destroy();
    await prisma.$disconnect();

    console.log('[Bot] Arret termine.');
    process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { void arreter(signal); });
}

client.login(process.env.BOT_TOKEN);
