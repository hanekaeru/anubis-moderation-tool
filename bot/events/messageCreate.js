const { Events } = require('discord.js');
const xpManager = require('../src/collectors/xp');
const activite = require('../src/collectors/activite');
const referentiel = require('../src/collectors/referentiel');

const cooldowns = new Set();

require('dotenv').config();

// Sans cette valeur de repli, un parseInt sur une variable absente renvoyait
// NaN et setTimeout se declenchait immediatement : le cooldown ne servait a rien.
const COOLDOWN_PAR_DEFAUT = 60_000;

function lireEntier(valeur, repli) {
    const parsed = Number.parseInt(valeur, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : repli;
}

module.exports = {
    name: Events.MessageCreate,
    once: false,
    async execute(message, client) {
        if (message.author.bot) return;
        // Messages prives : aucune statistique de serveur a tenir.
        if (!message.guild) return;

        // Le referentiel doit exister avant toute statistique : message_stats
        // porte des cles etrangeres vers le serveur, le membre et le salon.
        const contexteOk = await referentiel.garantirContexte(
            message.guild, message.author, message.channel,
        );

        if (contexteOk) {
            activite.enregistrerMessage(message);
        }

        const cooldownKey = `${message.author.id}:${message.guild.id}`;
        if (cooldowns.has(cooldownKey)) return;

        cooldowns.add(cooldownKey);
        setTimeout(
            () => cooldowns.delete(cooldownKey),
            lireEntier(process.env.COOLDOWN_BETWEEN_LEVEL_UP_MESSAGE, COOLDOWN_PAR_DEFAUT),
        );

        // You can get from 1 to 10 XP per message, plus a base of 15 XP.
        const randomXp = Math.floor(Math.random() * 11) + 15;
        await xpManager.addXp(message.author.id, message.guild.id, randomXp);
    },
};
