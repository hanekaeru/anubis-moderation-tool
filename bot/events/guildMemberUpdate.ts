import {
	AuditLogEvent,
	Events,
	type Client,
	type GuildMember,
	type PartialGuildMember,
} from "discord.js";
import type { BotEvent } from "../src/types";
import { IdentityEventType, SanctionType } from "@anubis/shared";
import prisma from "../src/prisma";
import * as referentiel from "../src/collectors/referentiel";
import * as moderation from "../src/collectors/moderation";
import { chercherAction, garantirAuteur } from "../src/collectors/discordAudit";

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
		} catch (err) {
			console.error(
				"[Referentiel] Mise a jour de membre non enregistree :",
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
				action?.reason ?? "Exclusion temporaire posee depuis Discord.",
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
				`[Moderation] Exclusion temporaire de ${nouveau.user.tag} enregistree` +
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
		reason: action?.reason ?? "Exclusion temporaire levee depuis Discord.",
	});

	if (levee) {
		console.log(
			`[Moderation] Exclusion temporaire de ${nouveau.user.tag} levee` +
				` (auteur : ${action?.executorTag ?? "inconnu"}).`,
		);
	}
}

export = event;
