import type { Client, GuildMember } from "discord.js";
import { SanctionType } from "@anubis/shared";
import * as moderation from "../collectors/moderation";
import * as shadowbanRole from "../collectors/shadowbanRole";

/** Types dont la revocation peut etre rejouee cote Discord. */
const REVOCABLE_TYPES: SanctionType[] = ["TIMEOUT", "SHADOWBAN", "BAN"];
/** Sanctions "en cours" (par opposition aux sanctions instantanees, sans duree). */
const ONGOING_SANCTION_TYPES: SanctionType[] = Object.values(SanctionType).filter(
	(type) => type !== SanctionType.KICK,
);
const INSTANT_TYPES: SanctionType[] = ["KICK"];

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

async function applyOngoingDiscordEffect(
	member: GuildMember,
	type: SanctionType,
	reason: string,
	duration: number,
): Promise<void> {
	switch (type) {
		case SanctionType.TIMEOUT:
			await member.timeout(duration * 1000, reason);
			break;
		case SanctionType.SHADOWBAN:
			await shadowbanRole.applyShadowban(member, reason);
			break;
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
 * `/unmute`, `/unshadowban` et `/unban` agissent sur Discord puis sur la base
 * dans la meme requete : `revokeActiveSanction` y pose `discordSyncedAt`
 * immediatement, donc ces revocations ne remontent jamais ici.
 * `POST /sanctions/:id/revoke` (dashboard) ne touche qu'a la base — c'est
 * cette verification qui rattrape l'effet Discord correspondant (timeout
 * leve, role Shadowban retire, bannissement leve).
 *
 * `BAN` est traite a part : une personne bannie n'est plus membre du
 * serveur, `guild.members.unban` agit directement sur son identifiant, sans
 * passer par un `GuildMember` a retrouver (il n'y en a pas).
 */
export async function checkRevokedSanctions(client: Client): Promise<void> {
	const unsynced =
		await moderation.findUnsyncedRevokedSanctions(REVOCABLE_TYPES);

	for (const sanction of unsynced) {
		const guild = client.guilds.cache.get(sanction.guildId);
		if (!guild) continue;

		try {
			if (sanction.type === SanctionType.BAN) {
				await guild.members.unban(
					sanction.userId,
					sanction.revokeReason ?? "Sanction levee depuis le dashboard.",
				);
			} else {
				const member = await guild.members
					.fetch(sanction.userId)
					.catch(() => null);

				if (member) {
					await liftDiscordEffect(
						member,
						sanction.type,
						sanction.revokeReason ??
						"Sanction levee depuis le dashboard.",
					);
				}
			}
		} catch (err) {
			console.error(
				`[Moderation] Synchronisation Discord echouee pour la sanction ${sanction.id} :`,
				err,
			);
		}

		await moderation.markDiscordSynced(sanction.id);
	}
}

/**
 * Applique cote Discord les sanctions "en cours" (TIMEOUT, SHADOWBAN, BAN)
 * posees depuis la webapp et pas encore repercutees.
 *
 * `BAN` ne necessite pas de retrouver un `GuildMember` : on peut bannir
 * quelqu'un qui a deja quitte le serveur (c'est meme un usage frequent).
 * Pour `TIMEOUT`/`SHADOWBAN`, un membre absent fait passer son tour a cette
 * sanction (elle reste `isApplied: false`) plutot que d'echouer : elle sera
 * appliquee des que le membre redevient joignable, au prochain passage.
 */
export async function checkAppliedSanctions(client: Client): Promise<void> {
	const pending = await moderation.findActiveSanctions(ONGOING_SANCTION_TYPES);

	for (const sanction of pending) {
		const guild = client.guilds.cache.get(sanction.guildId);
		if (!guild) continue;

		try {
			if (sanction.type === SanctionType.BAN) {
				await guild.members.ban(sanction.userId, { reason: sanction.reason });
			} else {
				const member = await guild.members
					.fetch(sanction.userId)
					.catch(() => null);

				if (!member) continue;

				await applyOngoingDiscordEffect(
					member,
					sanction.type,
					sanction.reason,
					sanction.durationSeconds ?? 0,
				);
			}

			await moderation.markDiscordAppliedSanction(sanction.id);
		} catch (err) {
			console.error(
				`[Moderation] Application webapp de la sanction ${sanction.id} echouee :`,
				err,
			);
		}
	}

	await checkAppliedInstantSanctions(client);
}

/**
 * Applique cote Discord les sanctions instantanees (KICK) posees depuis la
 * webapp.
 *
 * Une sanction instantanee passe directement au statut `EXPIRED` a la
 * creation (l'action n'a pas de duree a suivre) : elle ne remonte donc
 * jamais via `findActiveSanctions`, qui filtre sur `status: "ACTIVE"`. Sans
 * cette verification dediee, une expulsion posee depuis la webapp
 * n'expulsait jamais personne sur Discord — elle etait seulement marquee
 * comme appliquee sans que rien ne se passe.
 */
async function checkAppliedInstantSanctions(client: Client): Promise<void> {
	const pending = await moderation.findUnappliedInstantSanctions(INSTANT_TYPES);

	for (const sanction of pending) {
		const guild = client.guilds.cache.get(sanction.guildId);
		if (!guild) continue;

		try {
			if (sanction.type === SanctionType.KICK) {
				const member = await guild.members
					.fetch(sanction.userId)
					.catch(() => null);
				// Deja parti : rien a expulser, mais ce n'est pas un echec.
				if (member) await member.kick(sanction.reason);
			}

			await moderation.markDiscordAppliedSanction(sanction.id);
		} catch (err) {
			console.error(
				`[Moderation] Application webapp de la sanction instantanee ${sanction.id} echouee :`,
				err,
			);
		}
	}
}
