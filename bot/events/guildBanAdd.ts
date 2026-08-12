import { AuditLogEvent, Events } from "discord.js";
import { MemberStatus, SanctionType } from "@anubis/shared";
import type { BotEvent } from "../src/types";
import prisma from "../src/prisma";
import * as referentiel from "../src/collectors/referentiel";
import * as moderation from "../src/collectors/moderation";
import { chercherAction, garantirAuteur } from "../src/collectors/discordAudit";

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
					`[Moderation] Bannissement de ${user.tag} deja enregistre par la commande.`,
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
					`[Moderation] Bannissement de ${user.tag} enregistre` +
						` (auteur : ${action?.executorTag ?? "inconnu"}).`,
				);
			}
		} catch (err) {
			console.error("[Moderation] Bannissement non enregistre :", err);
		}
	},
};

export = event;
