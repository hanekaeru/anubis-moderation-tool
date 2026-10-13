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
import * as shadowbanRole from "../collectors/shadowbanRole";
import * as quarantine from "../collectors/quarantine";
import * as welcome from "../collectors/welcome";

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

			// Un nouveau boost se lit en base, pas sur `ancien` : un membre absent
			// du cache arrive partiel, sans `premiumSince`, et chaque mise a jour
			// d'un booster passerait pour un nouveau boost. La date n'est posee
			// que si elle manquait, et c'est le compte de lignes touchees qui dit
			// si le boost est nouveau — une seule annonce, meme si deux
			// evenements se croisent.
			let nouveauBoost = false;

			if (nouveau.premiumSince) {
				nouveauBoost =
					(
						await prisma.member.updateMany({
							where: { guildId, userId: nouveau.id, boostingSince: null },
							data: { boostingSince: nouveau.premiumSince },
						})
					).count > 0;

				if (
					!nouveauBoost &&
					ancien.premiumSince?.getTime() !== nouveau.premiumSince.getTime()
				) {
					await prisma.member.updateMany({
						where: { guildId, userId: nouveau.id },
						data: { boostingSince: nouveau.premiumSince },
					});
				}
			} else if (ancien.partial || ancien.premiumSince) {
				// Fin du boost. Effacee en base meme quand `ancien` est partiel :
				// une date restee posee ferait passer le prochain boost du membre
				// sous silence.
				await prisma.member.updateMany({
					where: { guildId, userId: nouveau.id, boostingSince: { not: null } },
					data: { boostingSince: null },
				});
			}

			if (nouveauBoost) {
				await welcome.annoncerBoost(nouveau).catch((err) => {
					console.error("[Accueil] Annonce de boost échouée :", err);
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

			if (ajoutes.length || retires.length) {
				await suivreQuarantaineManuelle(nouveau, client, ajoutes, retires);
			}
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
 *
 * La mise de cote des autres roles est rejouee ici, sans quoi le shadowban pose
 * a la main serait la seule facon d'en obtenir un qui ne restreint rien : les
 * roles conserves peuvent porter des autorisations explicites qui annulent les
 * refus. Le retrait manuel du role rend les roles de la meme facon —
 * `/unshadowban` ne peut pas etre le seul chemin de retour.
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

		// Le role est deja pose : `applyShadowban` se contente donc de mettre de
		// cote les autres. Un echec ne remet pas le shadowban en cause, il est
		// deja effectif — d'ou la trace en console plutot qu'une remontee.
		await shadowbanRole
			.applyShadowban(nouveau, action?.reason ?? "Shadowban posé depuis Discord.")
			.catch((err) => {
				console.error(
					`[Shadowban] Mise de côté des rôles de ${nouveau.id} échouée :`,
					err,
				);
			});

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

	// Les roles sont rendus meme si aucune sanction active n'a ete trouvee en
	// base : ce qui a ete pris doit revenir, que le journal ait suivi ou non.
	await shadowbanRole
		.liftShadowban(nouveau, action?.reason ?? "Shadowban retiré depuis Discord.")
		.catch((err) => {
			console.error(
				`[Shadowban] Restitution des rôles de ${nouveau.id} échouée :`,
				err,
			);
		});
}

/**
 * Fenetre pendant laquelle la pose du role de quarantaine est celle de
 * l'arrivee. Un retour en quarantaine dans la premiere minute n'aurait de toute
 * facon rien a defaire : le membre n'a encore rien valide.
 */
const ARRIVEE_RECENTE_MS = 60_000;

/**
 * Validation et retour en quarantaine faits a la main dans le client Discord.
 *
 * Retirer le role de quarantaine liberait le membre sur Discord sans que le
 * dashboard le sache : il restait affiche comme bloque, et le rattrapage
 * pouvait lui reposer le role a la prochaine etape. Le reposer, a l'inverse,
 * ne demandait aucune nouvelle validation.
 *
 * Les changements faits par le bot lui-meme sont ecartes par l'audit log, comme
 * pour le shadowban : il pose ce role a chaque arrivee et le retire a chaque
 * levee. Le retrait a en plus un garde independant de l'audit log, qui peut
 * manquer (permission absente) : `leverDepuisDiscord` relit le statut et ne
 * fait rien pour un membre deja libere.
 */
async function suivreQuarantaineManuelle(
	nouveau: GuildMember,
	client: Client,
	ajoutes: string[],
	retires: string[],
): Promise<void> {
	const roleId = await quarantine.roleDeQuarantaine(nouveau.guild.id);
	if (!roleId) return;

	const roleAjoute = ajoutes.includes(roleId);
	const roleRetire = retires.includes(roleId);
	if (!roleAjoute && !roleRetire) return;

	// Les deux cas courants se reconnaissent sans interroger l'audit log : le
	// role pose a l'arrivee, et le role retire par une levee deja enregistree.
	// Un raid de cinquante arrivees ferait sinon cinquante lectures du journal.
	if (roleAjoute && Date.now() - (nouveau.joinedTimestamp ?? 0) < ARRIVEE_RECENTE_MS) {
		return;
	}
	if (roleRetire && (await quarantine.estLibere(nouveau))) return;

	const cle = roleAjoute ? "$add" : "$remove";
	const action = await chercherAction(
		nouveau.guild,
		AuditLogEvent.MemberRoleUpdate,
		nouveau.id,
		(candidat) =>
			candidat.changes.some(
				(changement) =>
					changement.key === cle &&
					Array.isArray(changement.new) &&
					(changement.new as { id: string }[]).some((role) => role.id === roleId),
			),
	);

	if (action?.executorId && action.executorId === client.user?.id) return;

	if (roleRetire) {
		const auteurId = await garantirAuteur(client, action?.executorId ?? null);
		const resultat = await quarantine.leverDepuisDiscord(nouveau, auteurId);

		if (resultat === "levee") {
			console.log(
				`[Quarantaine] ${nouveau.user.tag} libéré depuis Discord` +
					` (auteur : ${action?.executorTag ?? "inconnu"}).`,
			);
		}
		return;
	}

	if (await quarantine.remettreEnQuarantaine(nouveau)) {
		console.log(
			`[Quarantaine] ${nouveau.user.tag} remis en quarantaine depuis Discord` +
				` (auteur : ${action?.executorTag ?? "inconnu"}).`,
		);
	}
}

export = event;
