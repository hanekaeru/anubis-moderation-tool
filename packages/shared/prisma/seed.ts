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
// Le bareme vient du contrat partage, pas d'une copie : des points de
// demonstration qui contredisent la page Bareme rendent le score
// incomprehensible pour qui recoupe les deux ecrans.
import { DEFAULT_MODERATION_POINTS } from "../src/dto/moderation";

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

		// Sans ce garde, chaque relance du seed empilait un avertissement, une
		// sanction et une note de plus sur les memes membres — alors que
		// l'en-tete de ce fichier promet un seed rejouable sans risque.
		const dejaSanctionne = await prisma.warning.count({
			where: { guildId, userId },
		});
		if (dejaSanctionne > 0) continue;

		const severity = i % 3 === 0 ? "HIGH" : i % 2 === 0 ? "MEDIUM" : "LOW";

		const warning = await prisma.warning.create({
			data: {
				guildId,
				userId,
				createdById: owner?.id ?? null,
				reason: reasons[i % reasons.length]!,
				severity,
				points: DEFAULT_MODERATION_POINTS.warningPoints[severity],
				createdAt,
			},
		});

		if (i % 2 === 0) {
			// Une sanction sur deux reste en cours : sans cela aucun membre de
			// demonstration n'aurait de sanction active, et la fiche laisserait
			// croire que les sanctions ne comptent jamais dans le score.
			const expiree = i % 4 === 0;
			const type = expiree ? "TIMEOUT" : "SHADOWBAN";

			await prisma.sanction.create({
				data: {
					guildId,
					userId,
					createdById: owner?.id ?? null,
					warningId: warning.id,
					type,
					reason: warning.reason,
					points: DEFAULT_MODERATION_POINTS.sanctionPoints[type],
					// Le shadowban est permanent : il reste actif, et une echeance
					// passee serait de toute facon rattrapee par la tache qui
					// expire les sanctions.
					durationSeconds: expiree ? 3600 : null,
					startsAt: createdAt,
					expiresAt: expiree
						? new Date(createdAt.getTime() + 3_600_000)
						: null,
					status: expiree ? "EXPIRED" : "ACTIVE",
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

	/**
	 * Echanges de chaque ticket.
	 *
	 * `messageCount` en est deduit plutot que tire au hasard : un compteur
	 * annoncant « 14 messages » au-dessus d'une chronologie vide se lit comme
	 * un bug de l'application, alors que c'est le jeu de demonstration qui
	 * etait incomplet.
	 */
	const conversations: { membre: boolean; texte: string }[][] = [
		[
			{ membre: true, texte: "Bonjour, je n ai plus acces au salon prive depuis ce matin." },
			{ membre: false, texte: "Bonjour, je regarde ca tout de suite." },
			{ membre: false, texte: "C etait un role retire par erreur lors du menage d hier. C est remis." },
			{ membre: true, texte: "Parfait, merci beaucoup !" },
		],
		[
			{ membre: true, texte: "Un membre tient des propos deplaces dans le salon vocal." },
			{ membre: false, texte: "Merci du signalement. Tu as un pseudo ou une capture ?" },
			{ membre: true, texte: "Oui, je vous envoie ca en message prive." },
			{ membre: false, texte: "Bien recu, on s en occupe." },
			{ membre: false, texte: "La situation a ete traitee, merci d avoir prevenu." },
		],
		[
			{ membre: true, texte: "Est-ce que je peux changer mon pseudo sur le serveur ?" },
			{ membre: false, texte: "Oui, tant qu il reste lisible et sans mention du staff." },
			{ membre: true, texte: "C est note, merci." },
		],
		[
			{ membre: true, texte: "Une question sur la regle 4 : elle vaut aussi en vocal ?" },
			{ membre: false, texte: "Oui, le reglement s applique partout, salons ecrits comme vocaux." },
			{ membre: true, texte: "D accord, c est plus clair." },
			{ membre: false, texte: "N hesite pas si tu as d autres questions." },
		],
		[
			{ membre: true, texte: "Mon XP n a pas bouge depuis hier alors que j ai ecrit." },
			{ membre: false, texte: "Il y a un delai entre deux gains, c est prevu pour eviter le spam." },
			{ membre: true, texte: "Ah, je comprends mieux. Merci !" },
		],
	];

	for (let i = 0; i < subjects.length; i++) {
		const openedAt = new Date(
			now.getTime() - randomInt(1, 40) * 86_400_000,
		);
		const closed = i % 2 === 0;
		const openerId = `92000000000000${String(i + 3).padStart(4, "0")}`;

		const echanges = conversations[i]!;
		const premiereReponse = new Date(
			openedAt.getTime() + randomInt(5, 240) * 60_000,
		);
		const closedAt = closed
			? new Date(openedAt.getTime() + randomInt(1, 5) * 86_400_000)
			: null;

		const ticket = await prisma.ticket.upsert({
			where: { guildId_number: { guildId, number: i + 1 } },
			update: { messageCount: echanges.length },
			create: {
				guildId,
				number: i + 1,
				openerId,
				assigneeId: "920000000000000000",
				claimedById: owner?.id ?? null,
				subject: subjects[i]!,
				category: i % 2 === 0 ? "SUPPORT" : "REPORT",
				status: closed ? "CLOSED" : "OPEN",
				priority: i === 1 ? "HIGH" : "NORMAL",
				openedAt,
				firstResponseAt: premiereReponse,
				closedAt,
				closedById: closed ? (owner?.id ?? null) : null,
				closeReason: closed ? "Demande traitee" : null,
				rating: closed ? randomInt(3, 6) : null,
				messageCount: echanges.length,
			},
		});

		// Les evenements ne sont poses qu'une fois : le seed est rejouable, et
		// un `createMany` sans garde empilerait la meme conversation a chaque
		// passage.
		const dejaPeuple = await prisma.ticketEvent.count({
			where: { ticketId: ticket.id },
		});
		if (dejaPeuple > 0) continue;

		const evenements: Prisma.TicketEventCreateManyInput[] = [
			{
				ticketId: ticket.id,
				type: "OPENED",
				actorId: openerId,
				occurredAt: openedAt,
			},
		];

		// Les messages s'etalent entre l'ouverture et la fermeture, pour que la
		// chronologie se lise dans l'ordre.
		const fin = closedAt ?? new Date(openedAt.getTime() + 6 * 3_600_000);
		const pas = (fin.getTime() - openedAt.getTime()) / (echanges.length + 1);

		echanges.forEach((echange, rang) => {
			evenements.push({
				ticketId: ticket.id,
				type: "MESSAGE",
				actorId: echange.membre ? openerId : "920000000000000000",
				occurredAt: new Date(openedAt.getTime() + pas * (rang + 1)),
				payload: { content: echange.texte, attachments: [] },
			});
		});

		evenements.push({
			ticketId: ticket.id,
			type: "INTERNAL_NOTE",
			appUserId: owner?.id ?? null,
			occurredAt: new Date(fin.getTime() - pas / 2),
			payload: { body: "Rien de particulier a signaler sur ce membre." },
		});

		if (closed && closedAt) {
			evenements.push(
				{
					ticketId: ticket.id,
					type: "STATUS_CHANGED",
					appUserId: owner?.id ?? null,
					occurredAt: closedAt,
					payload: { from: "OPEN", to: "CLOSED" },
				},
				{
					ticketId: ticket.id,
					type: "CLOSED",
					appUserId: owner?.id ?? null,
					occurredAt: closedAt,
				},
			);
		}

		await prisma.ticketEvent.createMany({ data: evenements });
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
