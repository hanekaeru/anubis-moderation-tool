import {
	AuditLogEvent,
	Events,
	type Client,
	type GuildMember,
	type PartialGuildMember,
} from "discord.js";
import type { BotEvent } from "../types";
import { IdentityEventType, SanctionType, SHADOWBAN_ROLE_CONFIG_KEY } from "@anubis/shared";
import prisma from "../prisma";
import * as referentiel from "../collectors/referentiel";
import * as moderation from "../collectors/moderation";
import { chercherAction, garantirAuteur } from "../collectors/discordAudit";
import * as guildConfig from "../collectors/guildConfig";

const event: BotEvent<typeof Events.GuildMemberUpdate> = {
	name: Events.GuildMemberUpdate,
	once: false,
	async execute(ancien, nouveau, client) {
		const guildId = nouveau.guild.id;

		try {
			if (ancien.nickname !== nouveau.nickname) {
				await prisma.member.updateMany({
					where: { guildId, userId: nouveau.id },
					data: { nickname: nouveau.nickname ?? null },
				});

				await referentiel.enregistrerEvenementIdentite(
					guildId,
					nouveau.id,
					IdentityEventType.NICKNAME_CHANGED,
					ancien.nickname ?? null,
					nouveau.nickname ?? null,
				);
			}

			if (
				ancien.premiumSince?.getTime() !==
				nouveau.premiumSince?.getTime()
			) {
				await prisma.member.updateMany({
					where: { guildId, userId: nouveau.id },
					data: { boostingSince: nouveau.premiumSince ?? null },
				});
			}

			const { ajoutes, retires } =
				await referentiel.synchroniserRoles(nouveau);

			if (ajoutes.length || retires.length) {
				await referentiel.enregistrerEvenementsRoles(
					guildId,
					nouveau.id,
					ajoutes,
					retires,
				);
			}

			await suivreExclusionTemporaire(ancien, nouveau, client);
			await suivreShadowbanManuel(nouveau, client, ajoutes, retires);
		} catch (err) {
			console.error(
				"[Référentiel] Mise à jour de membre non enregistrée :",
				err,
			);
		}
	},
};

/** Clef de changement utilisee par Discord pour l'exclusion temporaire. */
const CLEF_TIMEOUT = "communication_disabled_until";

/**
 * Detecte la pose et la levee d'une exclusion temporaire.
 *
 * Discord n'a pas d'evenement dedie : le timeout se lit dans la variation de
 * `communicationDisabledUntil` sur `guildMemberUpdate`, qui transporte aussi
 * les changements de surnom, de roles et de boost — d'ou le filtre sur la clef
 * de l'entree d'audit.
 */
async function suivreExclusionTemporaire(
	ancien: GuildMember | PartialGuildMember,
	nouveau: GuildMember,
	client: Client,
): Promise<void> {
	const avant = ancien.communicationDisabledUntilTimestamp ?? null;
	const apres = nouveau.communicationDisabledUntilTimestamp ?? null;

	if (avant === apres) return;

	const maintenant = Date.now();
	const actifAvant = avant !== null && avant > maintenant;
	const actifApres = apres !== null && apres > maintenant;

	// Ni avant ni apres : l'echeance vient simplement de passer. Personne n'a
	// agi, et l'API bascule deja le statut en base.
	if (!actifAvant && !actifApres) return;

	const action = await chercherAction(
		nouveau.guild,
		AuditLogEvent.MemberUpdate,
		nouveau.id,
		(candidat) =>
			candidat.changes.some(
				(changement) => changement.key === CLEF_TIMEOUT,
			),
	);

	// Timeout pose par une commande du bot : deja enregistre, avec son auteur.
	if (action?.executorId && action.executorId === client.user?.id) return;

	const moderatorId = await garantirAuteur(
		client,
		action?.executorId ?? null,
	);

	if (actifApres) {
		const sanction = await moderation.recordExternalSanction({
			guildId: nouveau.guild.id,
			userId: nouveau.id,
			moderatorId,
			type: SanctionType.TIMEOUT,
			reason:
				action?.reason ?? "Exclusion temporaire posée depuis Discord.",
			// La duree n'est pas dans l'audit log : elle se deduit de
			// l'echeance, ce que voit exactement le membre sanctionne.
			durationSeconds: Math.max(
				1,
				Math.round((apres! - maintenant) / 1000),
			),
			occurredAt: action?.createdAt,
		});

		if (sanction) {
			console.log(
				`[Modération] Exclusion temporaire de ${nouveau.user.tag} enregistrée` +
					` (auteur : ${action?.executorTag ?? "inconnu"}).`,
			);
		}
		return;
	}

	const levee = await moderation.revokeExternalSanction({
		guildId: nouveau.guild.id,
		userId: nouveau.id,
		type: SanctionType.TIMEOUT,
		moderatorId,
		reason: action?.reason ?? "Exclusion temporaire levée depuis Discord.",
	});

	if (levee) {
		console.log(
			`[Modération] Exclusion temporaire de ${nouveau.user.tag} levée` +
				` (auteur : ${action?.executorTag ?? "inconnu"}).`,
		);
	}
}

/**
 * Detecte l'attribution ou le retrait manuel du role de shadowban dans le
 * client Discord (en dehors de `/shadowban`/`/unshadowban`).
 *
 * Contrairement au bannissement, a l'expulsion ou au timeout, le shadowban
 * est un role applicatif : Discord n'a pas d'evenement dedie. On le repere
 * en comparant l'etat courant des roles a l'etat precedent, deja calcule par
 * `synchroniserRoles` pour l'historique (`ajoutes`/`retires`).
 */
async function suivreShadowbanManuel(
	nouveau: GuildMember,
	client: Client,
	ajoutes: string[],
	retires: string[],
): Promise<void> {
	const shadowbanRoleId = await guildConfig.getConfig(
		nouveau.guild.id,
		SHADOWBAN_ROLE_CONFIG_KEY,
	);
	if (!shadowbanRoleId) return;

	const roleAjoute = ajoutes.includes(shadowbanRoleId);
	const roleRetire = retires.includes(shadowbanRoleId);
	if (!roleAjoute && !roleRetire) return;

	const action = await chercherAction(
		nouveau.guild,
		AuditLogEvent.MemberRoleUpdate,
		nouveau.id,
		(candidat) =>
			candidat.changes.some(
				(changement) =>
					(changement.key === "$add" || changement.key === "$remove") &&
					Array.isArray(changement.new) &&
					(changement.new as { id: string }[]).some(
						(role) => role.id === shadowbanRoleId,
					),
			),
	);

	// Role pose/retire par /shadowban ou /unshadowban : deja enregistre avec
	// le moderateur reel, la reprendre ici en attribuerait la paternite au bot.
	if (action?.executorId && action.executorId === client.user?.id) return;

	const moderatorId = await garantirAuteur(client, action?.executorId ?? null);

	if (roleAjoute) {
		const sanction = await moderation.recordExternalSanction({
			guildId: nouveau.guild.id,
			userId: nouveau.id,
			moderatorId,
			type: SanctionType.SHADOWBAN,
			reason: action?.reason ?? "Rôle de shadowban attribué depuis Discord.",
			occurredAt: action?.createdAt,
		});

		if (sanction) {
			console.log(
				`[Modération] Shadowban de ${nouveau.user.tag} enregistré` +
					` (auteur : ${action?.executorTag ?? "inconnu"}).`,
			);
		}
		return;
	}

	const levee = await moderation.revokeExternalSanction({
		guildId: nouveau.guild.id,
		userId: nouveau.id,
		type: SanctionType.SHADOWBAN,
		moderatorId,
		reason: action?.reason ?? "Rôle de shadowban retiré depuis Discord.",
	});

	if (levee) {
		console.log(
			`[Modération] Shadowban de ${nouveau.user.tag} levé` +
				` (auteur : ${action?.executorTag ?? "inconnu"}).`,
		);
	}
}

export = event;
