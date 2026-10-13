import { Events } from "discord.js";
import type { BotEvent } from "../types";
import { MemberStatus } from "@anubis/shared";
import prisma from "../prisma";
import * as accountSurveillance from "../collectors/accountSurveillance";
import * as quarantine from "../collectors/quarantine";
import * as raid from "../collectors/raid";
import * as referentiel from "../collectors/referentiel";
import * as welcome from "../collectors/welcome";

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
				console.error("[Raid] Enregistrement de l'arrivée échoué :", err);
			});

			await accountSurveillance.evaluateNewMember(member).catch((err) => {
				console.error("[Comptes] Évaluation du nouveau membre échouée :", err);
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
					// Un boost s'arrete au depart : la date d'un ancien passage
					// ferait passer le prochain boost du membre sous silence.
					boostingSince: member.premiumSince ?? null,
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

			// Apres l'attribution du role de quarantaine, pour que l'etat des
			// roles enregistre soit celui d'apres la mise en quarantaine.
			await quarantine.quarantineNewMember(member).catch((err) => {
				console.error("[Quarantaine] Mise en quarantaine échouée :", err);
			});

			await referentiel.synchroniserRoles(member);
			console.log(`[Référentiel] Arrivée de ${member.user.tag}.`);

			await welcome.annoncerArrivee(member).catch((err) => {
				console.error("[Accueil] Message d'arrivée non envoyé :", err);
			});
		} catch (err) {
			console.error("[Référentiel] Arrivée non enregistrée :", err);
		}
	},
};

export = event;
