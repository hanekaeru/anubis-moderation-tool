import { Events } from "discord.js";
import type { BotEvent } from "../src/types";
import { MemberStatus } from "@anubis/shared";
import prisma from "../src/prisma";
import * as accountSurveillance from "../src/collectors/accountSurveillance";
import * as raid from "../src/collectors/raid";
import * as referentiel from "../src/collectors/referentiel";

const event: BotEvent<typeof Events.GuildMemberAdd> = {
	name: Events.GuildMemberAdd,
	once: false,
	async execute(member) {
		try {
			await referentiel.upsertUser(member.user);

			// Avant l'upsert ci-dessous, qui ecraserait un eventuel `leftAt` :
			// l'anti-raid compte l'arrivee elle-meme, la surveillance de comptes a
			// besoin de l'ancien `leftAt` pour detecter un retour rapide.
			await raid.recordJoin(member).catch((err) => {
				console.error("[Raid] Enregistrement de l'arrivee echoue :", err);
			});

			await accountSurveillance.evaluateNewMember(member).catch((err) => {
				console.error("[Comptes] Evaluation du nouveau membre echouee :", err);
			});

			await prisma.member.upsert({
				where: {
					guildId_userId: {
						guildId: member.guild.id,
						userId: member.id,
					},
				},
				update: {
					status: MemberStatus.ACTIVE,
					joinedAt: member.joinedAt,
					leftAt: null,
					nickname: member.nickname ?? null,
					// Un membre deja connu qui revient : on compte l'arrivee
					// supplementaire plutot que d'ecraser l'historique.
					joinCount: { increment: 1 },
				},
				create: {
					guildId: member.guild.id,
					userId: member.id,
					status: MemberStatus.ACTIVE,
					joinedAt: member.joinedAt,
					nickname: member.nickname ?? null,
				},
			});

			await referentiel.synchroniserRoles(member);
			console.log(`[Referentiel] Arrivee de ${member.user.tag}.`);
		} catch (err) {
			console.error("[Referentiel] Arrivee non enregistree :", err);
		}
	},
};

export = event;
