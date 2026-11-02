import type { GuildMember, GuildTextBasedChannel } from "discord.js";
import * as xpAnnounce from "./xpAnnounce";
import * as xpRewards from "./xpRewards";

/**
 * Suites d'une montee de niveau : roles de palier, puis annonce.
 *
 * Partage entre les messages et l'OWdle — les deux sources d'experience doivent
 * recompenser et annoncer de la meme facon, sinon un membre monte de niveau en
 * gagnant l'OWdle sans recevoir le role qui va avec.
 *
 * Les roles de palier sont poses avant l'annonce, pour pouvoir la completer :
 * « tu passes niveau 10 » et le role qui va avec se lisent mieux ensemble qu'en
 * deux messages a quelques secondes d'ecart. Aucune des deux etapes ne fait
 * echouer l'autre.
 */
export async function celebrerMontee(
	member: GuildMember,
	level: number,
	origin: GuildTextBasedChannel,
): Promise<void> {
	const earned = await xpRewards.applyForMember(member, level).catch((err) => {
		console.error("[XP] Attribution des paliers échouée :", err);
		return [] as string[];
	});

	await xpAnnounce
		.announceLevelUp({ member, level, earnedRoleIds: earned, origin })
		.catch((err) => {
			console.error("[XP] Annonce de montée de niveau échouée :", err);
		});
}
