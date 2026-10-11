import { Events } from "discord.js";
import type { BotEvent } from "../types";
import xpManager from "../collectors/xp";
import activite from "../collectors/activite";
import * as automod from "../collectors/automod";
import * as referentiel from "../collectors/referentiel";
import * as tickets from "../collectors/tickets";
import * as xpAnnounce from "../collectors/xpAnnounce";
import * as xpRewards from "../collectors/xpRewards";
import { readInt } from "../env";

const cooldowns = new Set<string>();

// Sans cette valeur de repli, un parseInt sur une variable absente renvoyait
// NaN et setTimeout se declenchait immediatement : le cooldown ne servait a rien.
const COOLDOWN_PAR_DEFAUT = 60_000;

const event: BotEvent<typeof Events.MessageCreate> = {
	name: Events.MessageCreate,
	once: false,
	async execute(message) {
		if (message.author.bot) return;
		// Messages prives : aucune statistique de serveur a tenir.
		if (!message.inGuild()) return;

		// Le referentiel doit exister avant toute statistique : message_stats
		// porte des cles etrangeres vers le serveur, le membre et le salon.
		const contexteOk = await referentiel.garantirContexte(
			message.guild,
			message.author,
			message.channel,
		);

		if (contexteOk) {
			activite.enregistrerMessage(message);
		}

		await automod.processMessage(message).catch((err) => {
			console.error("[Automod] Traitement du message échoué :", err);
		});

		const ticketId = tickets.ticketIdForChannel(message.channel.id);
		if (ticketId) {
			await tickets.recordMessage(ticketId, message).catch((err) => {
				console.error("[Tickets] Enregistrement du message échoué :", err);
			});
		}

		// Apres l'activite et l'automod, avant le cooldown : un salon sans XP
		// reste compte dans les statistiques et reste modere. Poser le test
		// plus haut reviendrait a ne plus rien y surveiller.
		//
		// Avant le cooldown, et non apres : consommer le delai d'attente dans un
		// salon qui ne rapporte rien priverait le membre de son gain suivant
		// ailleurs.
		if (
			await xpAnnounce.gainBloque(
				message.guild.id,
				message.channel.id,
				message.channel.isThread() ? message.channel.parentId : null,
			)
		) {
			return;
		}

		const cooldownKey = `${message.author.id}:${message.guild.id}`;
		if (cooldowns.has(cooldownKey)) return;

		cooldowns.add(cooldownKey);
		setTimeout(
			() => cooldowns.delete(cooldownKey),
			readInt("COOLDOWN_BETWEEN_LEVEL_UP_MESSAGE", COOLDOWN_PAR_DEFAUT),
		);

		// You can get from 1 to 10 XP per message, plus a base of 15 XP.
		const randomXp = Math.floor(Math.random() * 11) + 15;
		const { before, after } = await xpManager.addXp(
			message.author.id,
			message.guild.id,
			randomXp,
		);

		// Le passage de palier est le seul retour que le membre recoit du
		// systeme d'XP sans avoir a taper une commande. Ou et comment il le
		// recoit est un reglage du serveur (`xp_config`), lu par
		// `xpAnnounce.announceLevelUp`.
		if (after.level > before.level) {
			// `message.member` est renseigne par la passerelle sur un message de
			// serveur, mais pas garanti : le repli evite qu'une montee de niveau
			// passe sous silence, roles compris.
			const member =
				message.member ??
				(await message.guild.members.fetch(message.author.id).catch(() => null));
			if (!member) return;

			// Les roles de palier sont poses avant l'annonce, pour pouvoir la
			// completer : « tu passes niveau 10 » et le role qui va avec se lisent
			// mieux ensemble qu'en deux messages a quelques secondes d'ecart.
			const earned = await xpRewards
				.applyForMember(member, after.level)
				.catch((err) => {
					console.error("[XP] Attribution des paliers échouée :", err);
					return [] as string[];
				});

			await xpAnnounce
				.announceLevelUp({
					member,
					level: after.level,
					earnedRoleIds: earned,
					origin: message.channel,
				})
				.catch((err) => {
					console.error("[XP] Annonce de montée de niveau échouée :", err);
				});
		}
	},
};

export = event;
