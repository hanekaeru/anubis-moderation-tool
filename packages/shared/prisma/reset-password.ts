/**
 * Reinitialise le mot de passe d'un compte du dashboard.
 *
 * Le seed ne touche jamais a un compte existant : il ne peut donc pas
 * redonner un mot de passe perdu. Cette commande le fait, sur le meme modele —
 * mot de passe genere, affiche une seule fois, a changer a la connexion.
 *
 *   npm run db:reset-password              (compte "admin")
 *   npm run db:reset-password -- moderateur
 *
 * `RESET_PASSWORD` impose un mot de passe choisi, sans changement force.
 *
 * Les sessions ouvertes du compte sont revoquees, le verrou leve. La double
 * authentification n'est **pas** touchee : perdre son mot de passe ne doit pas
 * suffire a la retirer (voir la route de reinitialisation dediee).
 */
import { randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { PrismaClient } from "../generated/client";

const prisma = new PrismaClient();

const USERNAME =
	process.argv[2] ?? process.env.SEED_ADMIN_USERNAME ?? "admin";

async function main(): Promise<void> {
	const user = await prisma.appUser.findUnique({
		where: { username: USERNAME },
	});

	if (!user) {
		const comptes = await prisma.appUser.findMany({
			select: { username: true },
			orderBy: { username: "asc" },
		});
		console.error(`[x] Aucun compte "${USERNAME}".`);
		console.error(
			comptes.length
				? `    Comptes existants : ${comptes.map((c) => c.username).join(", ")}`
				: "    La base n'a aucun compte : lancer `npm run db:seed`.",
		);
		process.exitCode = 1;
		return;
	}

	const chosen = process.env.RESET_PASSWORD;
	const password = chosen ?? randomBytes(18).toString("base64url");
	const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

	await prisma.$transaction([
		prisma.appUser.update({
			where: { id: user.id },
			data: {
				passwordHash,
				mustChangePassword: !chosen,
				failedLoginCount: 0,
				lockedUntil: null,
				isActive: true,
			},
		}),
		prisma.refreshToken.updateMany({
			where: { appUserId: user.id, revokedAt: null },
			data: { revokedAt: new Date() },
		}),
	]);

	console.log(`[+] Mot de passe de "${USERNAME}" reinitialise.`);
	if (!chosen) {
		console.log(`    mot de passe : ${password}`);
		console.log("    (affiche une seule fois — a changer a la connexion)");
	}
	if (user.totpEnabledAt) {
		console.log(
			"[!] Double authentification active sur ce compte : le code reste demande.",
		);
	}
}

main()
	.catch((error) => {
		console.error("Echec de la reinitialisation :", error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
