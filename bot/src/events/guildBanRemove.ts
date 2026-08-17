import { AuditLogEvent, Events } from "discord.js";
import { MemberStatus, SanctionType } from "@anubis/shared";
import type { BotEvent } from "../types";
import prisma from "../prisma";
import * as referentiel from "../collectors/referentiel";
import * as moderation from "../collectors/moderation";
import { chercherAction, garantirAuteur } from "../collectors/discordAudit";

const event: BotEvent<typeof Events.GuildBanRemove> = {
	name: Events.GuildBanRemove,
	once: false,
	async execute(ban, client) {
		const { guild, user } = ban;

		try {
			await referentiel.upsertUser(user);

			// Debanni mais toujours absent du serveur : le statut redevient
			// "parti", pas "present".
			await prisma.member.updateMany({
				where: { guildId: guild.id, userId: user.id },
				data: { status: MemberStatus.LEFT },
			});

			const action = await chercherAction(
				guild,
				AuditLogEvent.MemberBanRemove,
				user.id,
			);

			if (action?.executorId && action.executorId === client.user?.id) {
				console.log(
					`[Modération] Débannissement de ${user.tag} déjà enregistré par la commande.`,
				);
				return;
			}

			const moderatorId = await garantirAuteur(
				client,
				action?.executorId ?? null,
			);

			const levee = await moderation.revokeExternalSanction({
				guildId: guild.id,
				userId: user.id,
				type: SanctionType.BAN,
				moderatorId,
				reason: action?.reason ?? "Débannissement depuis Discord.",
			});

			console.log(
				levee
					? `[Modération] Bannissement de ${user.tag} levé (auteur : ${action?.executorTag ?? "inconnu"}).`
					: // Cas normal pour un bannissement anterieur a la mise en
						// service du bot : il n'y a aucune sanction a lever.
						`[Modération] Débannissement de ${user.tag} sans sanction correspondante.`,
			);
		} catch (err) {
			console.error("[Modération] Débannissement non enregistré :", err);
		}
	},
};

export = event;
