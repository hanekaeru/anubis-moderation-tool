import type { Client, GuildMember } from "discord.js";
import type { SanctionType } from "@anubis/shared";
import * as moderation from "../collectors/moderation";
import * as shadowbanRole from "../collectors/shadowbanRole";

const REVOCABLE_TYPES: SanctionType[] = ["TIMEOUT", "SHADOWBAN"];

async function liftDiscordEffect(
	member: GuildMember,
	type: SanctionType,
	reason: string,
): Promise<void> {
	if (type === "TIMEOUT") {
		await member.timeout(null, reason);
	} else if (type === "SHADOWBAN") {
		await shadowbanRole.liftShadowban(member, reason);
	}
}

/**
 * Leve les shadowbans arrives a expiration.
 *
 * Un shadowban est un role, pas un timeout Discord natif : Discord ne le
 * retire jamais tout seul. L'API bascule bien la sanction en `EXPIRED` en
 * base (cron NestJS), mais n'a aucune prise sur Discord — sans cette
 * verification cote bot, le role resterait attribue indefiniment.
 */
export async function checkExpiredShadowbans(client: Client): Promise<void> {
	const expired = await moderation.findExpiredActiveSanctions("SHADOWBAN");

	for (const sanction of expired) {
		const guild = client.guilds.cache.get(sanction.guildId);
		const member = guild
			? await guild.members.fetch(sanction.userId).catch(() => null)
			: null;

		if (member) {
			try {
				await shadowbanRole.liftShadowban(
					member,
					"Expiration automatique du shadowban.",
				);
			} catch (err) {
				console.error(
					`[Shadowban] Levee automatique echouee pour ${sanction.userId} :`,
					err,
				);
			}
		}

		await moderation.markSanctionExpired(
			sanction.id,
			sanction.guildId,
			sanction.userId,
			"SHADOWBAN",
		);
	}
}

/**
 * Repercute cote Discord les sanctions revoquees depuis la webapp.
 *
 * `/unmute` et `/unshadowban` agissent sur Discord puis sur la base dans la
 * meme requete : `revokeActiveSanction` y pose `discordSyncedAt`
 * immediatement, donc ces revocations ne remontent jamais ici.
 * `POST /sanctions/:id/revoke` (dashboard) ne touche qu'a la base — c'est
 * cette verification qui rattrape l'effet Discord correspondant (timeout
 * leve, role Shadowban retire).
 */
export async function checkRevokedSanctions(client: Client): Promise<void> {
	const unsynced =
		await moderation.findUnsyncedRevokedSanctions(REVOCABLE_TYPES);

	for (const sanction of unsynced) {
		const guild = client.guilds.cache.get(sanction.guildId);
		const member = guild
			? await guild.members.fetch(sanction.userId).catch(() => null)
			: null;

		if (member) {
			try {
				await liftDiscordEffect(
					member,
					sanction.type,
					sanction.revokeReason ??
						"Sanction levee depuis le dashboard.",
				);
			} catch (err) {
				console.error(
					`[Moderation] Synchronisation Discord echouee pour la sanction ${sanction.id} :`,
					err,
				);
			}
		}

		await moderation.markDiscordSynced(sanction.id);
	}
}

/**
 * Fonction qui vérifie en base si une sanction a été appliquée via l'application web et qui n'a pas encore été répercutée sur Discord. Si c'est le
 * cas, elle applique l'effet correspondant sur Discord.
 * Cette fonction est appelée toutes les 30 secondes par le bot, et permet de s'assurer que les sanctions appliquées via l'application web sont bien
 * répercutées sur Discord.
 */
export async function checkAppliedSanctions(client: Client): Promise<void> {
	// Récupérer la liste des sanctions actives et avec cette liste, je regarde si elles ne sont pas arrivée à terme
	// donc si la date d'expiration est supérieure à la date actuelle. Si c'est le cas, on regarde l'utilisateur Discord
	// et on vérifie si il est toujours sanctionné.
	const result = await moderation.findActiveSanctions("SHADOWBAN");
}
