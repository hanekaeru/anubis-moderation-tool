/**
 * Seed de la base.
 *
 * Sans argument : cree le serveur et le compte proprietaire, rien d'autre.
 * Idempotent, donc rejouable sans risque sur une base existante.
 *
 *   npm run db:seed
 *   npm run db:seed -- --demo    (ajoute un jeu de donnees de demonstration)
 */
import { randomBytes, randomInt } from "node:crypto";
import * as argon2 from "argon2";
import { PrismaClient, Prisma } from "../generated/client";

const prisma = new PrismaClient();

const GUILD_ID = process.env.SEED_GUILD_ID ?? process.env.GUILD_HOST_ID ?? "";
const GUILD_NAME = process.env.SEED_GUILD_NAME ?? "Serveur Anubis";
const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME ?? "admin";
const WITH_DEMO = process.argv.includes("--demo");

/** Mot de passe lisible mais fort, affiche une seule fois a la creation. */
function generatePassword(): string {
	return randomBytes(18).toString("base64url");
}

async function seedOwner(): Promise<void> {
	const existing = await prisma.appUser.findUnique({
		where: { username: ADMIN_USERNAME },
	});

	if (existing) {
		console.log(`[=] Compte "${ADMIN_USERNAME}" deja present, inchange.`);
		return;
	}

	const password = process.env.SEED_ADMIN_PASSWORD ?? generatePassword();
	const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

	await prisma.appUser.create({
		data: {
			username: ADMIN_USERNAME,
			passwordHash,
			displayName: "Administrateur",
			role: "OWNER",
			// Impose le changement uniquement si le mot de passe a ete genere.
			mustChangePassword: !process.env.SEED_ADMIN_PASSWORD,
		},
	});

	console.log("[+] Compte proprietaire cree.");
	console.log(`    identifiant : ${ADMIN_USERNAME}`);
	if (!process.env.SEED_ADMIN_PASSWORD) {
		console.log(`    mot de passe : ${password}`);
		console.log("    (affiche une seule fois — a changer a la connexion)");
	}
}

async function seedGuild(): Promise<string | null> {
	if (!GUILD_ID) {
		console.log(
			"[!] SEED_GUILD_ID absent : le serveur ne sera pas cree. Le bot le fera au demarrage.",
		);
		return null;
	}

	await prisma.guild.upsert({
		where: { id: GUILD_ID },
		update: { name: GUILD_NAME },
		create: { id: GUILD_ID, name: GUILD_NAME },
	});

	console.log(`[+] Serveur ${GUILD_ID} pret.`);
	return GUILD_ID;
}

/** Jeu de donnees suffisant pour que tous les ecrans aient quelque chose a afficher. */
async function seedDemo(guildId: string): Promise<void> {
	console.log("[~] Generation des donnees de demonstration...");

	const roles = [
		{
			id: "900000000000000001",
			name: "Membre",
			color: 0x99aab5,
			position: 1,
		},
		{
			id: "900000000000000002",
			name: "Actif",
			color: 0x2ecc71,
			position: 2,
		},
		{
			id: "900000000000000003",
			name: "Moderateur",
			color: 0x3498db,
			position: 5,
		},
	];

	for (const role of roles) {
		await prisma.role.upsert({
			where: { id: role.id },
			update: {
				name: role.name,
				color: role.color,
				position: role.position,
			},
			create: { ...role, guildId },
		});
	}

	const channels = [
		{ id: "910000000000000001", name: "general", type: 0 },
		{ id: "910000000000000002", name: "discussions", type: 0 },
		{ id: "910000000000000003", name: "aide", type: 0 },
		{ id: "910000000000000004", name: "Vocal 1", type: 2 },
	];

	for (const channel of channels) {
		await prisma.channel.upsert({
			where: { id: channel.id },
			update: { name: channel.name },
			create: { ...channel, guildId },
		});
	}

	const owner = await prisma.appUser.findUnique({
		where: { username: ADMIN_USERNAME },
	});

	const names = [
		"kaelis",
		"norwin",
		"ysera",
		"tobias",
		"melira",
		"darven",
		"sylune",
		"orvath",
		"ines",
		"kalem",
		"rowan",
		"thelia",
	];

	const now = new Date();

	for (let i = 0; i < names.length; i++) {
		const userId = `92000000000000${String(i).padStart(4, "0")}`;
		const username = names[i]!;
		const joinedAt = new Date(
			now.getTime() - randomInt(30, 700) * 86_400_000,
		);

		await prisma.discordUser.upsert({
			where: { id: userId },
			update: { username },
			create: {
				id: userId,
				username,
				globalName: username[0]!.toUpperCase() + username.slice(1),
				accountCreatedAt: new Date(
					joinedAt.getTime() - 86_400_000 * 400,
				),
			},
		});

		await prisma.member.upsert({
			where: { guildId_userId: { guildId, userId } },
			update: {},
			create: { guildId, userId, joinedAt, status: "ACTIVE" },
		});

		// Roles : tout le monde membre, quelques-uns actifs, deux moderateurs.
		const assigned = [roles[0]!.id];
		if (i % 3 === 0) assigned.push(roles[1]!.id);
		if (i < 2) assigned.push(roles[2]!.id);

		for (const roleId of assigned) {
			await prisma.memberRole.upsert({
				where: { guildId_userId_roleId: { guildId, userId, roleId } },
				update: {},
				create: { guildId, userId, roleId, assignedAt: joinedAt },
			});
		}

		// Activite : 90 jours d'agregats, avec un creux le week-end.
		const stats: Prisma.MessageStatCreateManyInput[] = [];
		for (let d = 0; d < 90; d++) {
			const day = new Date(now.getTime() - d * 86_400_000);
			day.setUTCHours(0, 0, 0, 0);
			const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
			const base = Math.max(0, 12 - i) * (weekend ? 0.4 : 1);
			const count = Math.round(base * Math.random() * 2);
			if (count === 0) continue;

			const channelId = channels[randomInt(0, 3)]!.id;
			stats.push({
				guildId,
				userId,
				channelId,
				day,
				messageCount: count,
				attachmentCount: randomInt(
					0,
					Math.max(1, Math.floor(count / 4)),
				),
				totalCharacters: BigInt(count * randomInt(20, 180)),
			});
		}

		if (stats.length) {
			await prisma.messageStat.createMany({
				data: stats,
				skipDuplicates: true,
			});
		}

		// Profil horaire : pic en soiree, creux la nuit, week-end plus calme.
		// C'est ce qui alimente la carte de chaleur de la fiche membre.
		const profile: Prisma.MemberActivityProfileCreateManyInput[] = [];
		for (let weekday = 0; weekday < 7; weekday++) {
			for (let hour = 0; hour < 24; hour++) {
				const nightFactor = hour >= 2 && hour <= 8 ? 0.05 : 1;
				const eveningFactor = hour >= 18 && hour <= 23 ? 1.8 : 1;
				const weekendFactor = weekday >= 5 ? 0.6 : 1;
				const count = Math.round(
					Math.max(0, 12 - i) *
						nightFactor *
						eveningFactor *
						weekendFactor *
						(0.5 + Math.random()),
				);
				if (count > 0) {
					profile.push({
						guildId,
						userId,
						weekday,
						hour,
						messageCount: count,
					});
				}
			}
		}

		if (profile.length) {
			await prisma.memberActivityProfile.createMany({
				data: profile,
				skipDuplicates: true,
			});
		}

		await prisma.userLevel.upsert({
			where: { userId_guildId: { userId, guildId } },
			update: {},
			create: { userId, guildId, xp: BigInt(randomInt(0, 25_000)) },
		});

		// Historique d'identite pour un membre sur trois.
		if (i % 3 === 1) {
			await prisma.identityEvent.create({
				data: {
					guildId,
					userId,
					type: "NICKNAME_CHANGED",
					oldValue: username,
					newValue: `${username}_`,
					occurredAt: new Date(
						now.getTime() - randomInt(1, 60) * 86_400_000,
					),
				},
			});
		}
	}

	// Avertissements et sanctions sur les premiers membres.
	const reasons = [
		"Spam repete en salon general",
		"Propos deplaces envers un autre membre",
		"Publicite non autorisee",
		"Refus des consignes de la moderation",
	];

	for (let i = 2; i < 7; i++) {
		const userId = `92000000000000${String(i).padStart(4, "0")}`;
		const createdAt = new Date(
			now.getTime() - randomInt(1, 60) * 86_400_000,
		);

		const warning = await prisma.warning.create({
			data: {
				guildId,
				userId,
				createdById: owner?.id ?? null,
				reason: reasons[i % reasons.length]!,
				severity: i % 3 === 0 ? "HIGH" : i % 2 === 0 ? "MEDIUM" : "LOW",
				points: (i % 3) + 1,
				createdAt,
			},
		});

		if (i % 2 === 0) {
			await prisma.sanction.create({
				data: {
					guildId,
					userId,
					createdById: owner?.id ?? null,
					warningId: warning.id,
					type: i % 4 === 0 ? "TIMEOUT" : "VOICE_MUTE",
					reason: warning.reason,
					durationSeconds: 3600,
					startsAt: createdAt,
					expiresAt: new Date(createdAt.getTime() + 3_600_000),
					status: "EXPIRED",
					createdAt,
				},
			});
		}

		if (owner) {
			await prisma.memberNote.create({
				data: {
					guildId,
					userId,
					authorId: owner.id,
					body: "Membre a surveiller : deja repris a plusieurs reprises.",
					pinned: i === 2,
				},
			});
		}

		// Trace d'activite de moderation : c'est elle, et non les tables
		// warnings/sanctions, qui alimente le classement du tableau de bord.
		if (owner) {
			await prisma.moderationActivity.createMany({
				data: [
					{
						guildId,
						appUserId: owner.id,
						action: "warn",
						targetUserId: userId,
						targetType: "warning",
						targetId: warning.id,
						occurredAt: createdAt,
					},
					{
						guildId,
						appUserId: owner.id,
						action: "note.create",
						targetUserId: userId,
						targetType: "note",
						occurredAt: createdAt,
					},
				],
			});
		}
	}

	// Tickets.
	const subjects = [
		"Probleme d acces au salon prive",
		"Signalement d un membre",
		"Demande de changement de pseudo",
		"Question sur les regles du serveur",
		"Bug avec le systeme d XP",
	];

	for (let i = 0; i < subjects.length; i++) {
		const openedAt = new Date(
			now.getTime() - randomInt(1, 40) * 86_400_000,
		);
		const closed = i % 2 === 0;
		const openerId = `92000000000000${String(i + 3).padStart(4, "0")}`;

		await prisma.ticket.upsert({
			where: { guildId_number: { guildId, number: i + 1 } },
			update: {},
			create: {
				guildId,
				number: i + 1,
				openerId,
				assigneeId: "920000000000000000",
				claimedById: owner?.id ?? null,
				subject: subjects[i]!,
				category: i % 2 === 0 ? "support" : "signalement",
				status: closed ? "CLOSED" : "OPEN",
				priority: i === 1 ? "HIGH" : "NORMAL",
				openedAt,
				firstResponseAt: new Date(
					openedAt.getTime() + randomInt(5, 240) * 60_000,
				),
				closedAt: closed
					? new Date(
							openedAt.getTime() + randomInt(1, 5) * 86_400_000,
						)
					: null,
				closedById: closed ? (owner?.id ?? null) : null,
				closeReason: closed ? "Demande traitee" : null,
				rating: closed ? randomInt(3, 6) : null,
				messageCount: randomInt(3, 25),
			},
		});
	}

	console.log("[+] Donnees de demonstration en place.");
}

async function main(): Promise<void> {
	const guildId = await seedGuild();
	await seedOwner();

	if (WITH_DEMO) {
		if (!guildId) {
			console.error(
				"[x] --demo necessite SEED_GUILD_ID (identifiant du serveur Discord).",
			);
			process.exitCode = 1;
			return;
		}
		await seedDemo(guildId);
	}

	console.log("Seed termine.");
}

main()
	.catch((error) => {
		console.error("Echec du seed :", error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
