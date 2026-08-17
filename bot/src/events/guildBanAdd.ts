import { AuditLogEvent, Events } from "discord.js";
import { MemberStatus, SanctionType } from "@anubis/shared";
import type { BotEvent } from "../types";
import prisma from "../prisma";
import * as referentiel from "../collectors/referentiel";
import * as moderation from "../collectors/moderation";
import { chercherAction, garantirAuteur } from "../collectors/discordAudit";

const event: BotEvent<typeof Events.GuildBanAdd> = {
	name: Events.GuildBanAdd,
	once: false,
	async execute(ban, client) {
		const { guild, user } = ban;

		try {
			await referentiel.upsertGuild(guild);
			await referentiel.upsertUser(user);

			// `upsert` et non `updateMany` : on peut bannir quelqu'un qui n'a
			// jamais ete membre du serveur, et la sanction a besoin d'une fiche.
			await prisma.member.upsert({
				where: {
					guildId_userId: { guildId: guild.id, userId: user.id },
				},
				update: { status: MemberStatus.BANNED, leftAt: new Date() },
				create: {
					guildId: guild.id,
					userId: user.id,
					status: MemberStatus.BANNED,
					leftAt: new Date(),
				},
			});

			await prisma.memberRole.deleteMany({
				where: { guildId: guild.id, userId: user.id },
			});

			const action = await chercherAction(
				guild,
				AuditLogEvent.MemberBanAdd,
				user.id,
			);

			// Bannissement pose par une commande du bot : la sanction est deja
			// enregistree, avec le moderateur reel. La reprendre ici en
			// attribuerait la paternite au bot lui-meme.
			if (action?.executorId && action.executorId === client.user?.id) {
				console.log(
					`[Modération] Bannissement de ${user.tag} déjà enregistré par la commande.`,
				);
				return;
			}

			const moderatorId = await garantirAuteur(
				client,
				action?.executorId ?? null,
			);

			const sanction = await moderation.recordExternalSanction({
				guildId: guild.id,
				userId: user.id,
				moderatorId,
				type: SanctionType.BAN,
				reason:
					action?.reason ??
					ban.reason ??
					"Bannissement pose depuis Discord.",
				occurredAt: action?.createdAt,
			});

			if (sanction) {
				console.log(
					`[Modération] Bannissement de ${user.tag} enregistré` +
						` (auteur : ${action?.executorTag ?? "inconnu"}).`,
				);
			}
		} catch (err) {
			console.error("[Modération] Bannissement non enregistré :", err);
		}
	},
};

export = event;
