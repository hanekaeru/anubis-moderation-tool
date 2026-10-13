import {
	AuditLogEvent,
	Events,
	type Client,
	type GuildMember,
	type PartialGuildMember,
} from "discord.js";
import { MemberStatus, SanctionType } from "@anubis/shared";
import type { BotEvent } from "../types";
import prisma from "../prisma";
import * as moderation from "../collectors/moderation";
import * as welcome from "../collectors/welcome";import { chercherAction, garantirAuteur } from "../collectors/discordAudit";

const event: BotEvent<typeof Events.GuildMemberRemove> = {
	name: Events.GuildMemberRemove,
	once: false,
	async execute(member, client) {
		const guildId = member.guild.id;

		try {
			// Un bannissement declenche aussi cet evenement. `guildBanAdd` a pu
			// arriver en premier et poser le statut BANNED : le filtre l'empeche
			// d'etre retrograde en LEFT, quel que soit l'ordre d'arrivee.
			await prisma.member.updateMany({
				where: {
					guildId,
					userId: member.id,
					status: { not: MemberStatus.BANNED },
				},
				data: { status: MemberStatus.LEFT, leftAt: new Date() },
			});

			// Les roles portes ne veulent plus rien dire une fois parti ;
			// l'historique des ajouts et retraits, lui, est conserve.
			await prisma.memberRole.deleteMany({
				where: { guildId, userId: member.id },
			});

			await welcome.annoncerDepart(member).catch((err) => {
				console.error("[Accueil] Message de départ non envoyé :", err);
			});
			await enregistrerExpulsionEventuelle(member, client);
		} catch (err) {
			console.error("[Référentiel] Départ non enregistré :", err);
		}
	},
};

/**
 * Distingue une expulsion d'un depart volontaire.
 *
 * Discord n'a pas d'evenement d'expulsion : `guildMemberRemove` couvre le
 * depart volontaire, l'expulsion et le bannissement. Seule la presence d'une
 * entree `MemberKick` dans l'audit log permet de trancher — un bannissement
 * n'en produit pas, il est traite par `guildBanAdd`.
 */
async function enregistrerExpulsionEventuelle(
	member: GuildMember | PartialGuildMember,
	client: Client,
): Promise<void> {
	const guild = member.guild;
	const action = await chercherAction(
		guild,
		AuditLogEvent.MemberKick,
		member.id,
	);

	// Aucune entree : depart volontaire, rien de plus a enregistrer.
	if (!action) return;

	if (action.executorId && action.executorId === client.user?.id) {
		console.log(
			`[Modération] Expulsion de ${member.id} déjà enregistrée par la commande.`,
		);
		return;
	}

	const moderatorId = await garantirAuteur(client, action.executorId);

	const sanction = await moderation.recordExternalSanction({
		guildId: guild.id,
		userId: member.id,
		moderatorId,
		type: SanctionType.KICK,
		reason: action.reason ?? "Expulsion depuis Discord.",
		occurredAt: action.createdAt,
	});

	if (sanction) {
		console.log(
			`[Modération] Expulsion de ${member.user?.tag ?? member.id} enregistrée` +
				` (auteur : ${action.executorTag ?? "inconnu"}).`,
		);
	}
}

export = event;
