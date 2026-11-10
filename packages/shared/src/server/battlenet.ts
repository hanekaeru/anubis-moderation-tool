import { battlenetUnlinkResetsVerification } from "../battlenet";
import { quarantineStage } from "../dto/quarantine";

/**
 * Deliaison d'un compte Battle.net, commune au dashboard
 * (`api/src/verification/battlenet-links.service.ts`) et a Discord
 * (`/delier_battlenet`, `/delier_battlenet_admin`).
 *
 * Les deux chemins doivent laisser la meme trace et faire reculer la
 * quarantaine de la meme facon : une deliaison qui oublierait la trace d'un
 * cote rouvrirait le compte Blizzard a un compte secondaire, une qui oublierait
 * le recul laisserait entrer un membre sans lien.
 */

/**
 * Ce que la deliaison demande au client Prisma, et rien de plus. Le client du
 * bot, le service de l'API ou une transaction en cours s'y conforment.
 *
 * Decrit a la main plutot qu'importe de `generated/client` : le package
 * partage se compile **avant** `prisma generate` (images Docker de l'API et du
 * bot), et le dashboard verifie ses sources sans jamais generer le client.
 * Importer le type faisait echouer les deux constructions.
 */
interface Db {
	battlenetAccount: {
		findMany(args: {
			where: { userId: string };
		}): Promise<{ battlenetHash: string; unlinkedAt: Date | null }[]>;
		deleteMany(args: { where: { userId: string } }): Promise<unknown>;
		update(args: {
			where: { battlenetHash: string };
			data: {
				unlinkedAt: Date;
				unlinkedById: string | null;
				unlinkedByDiscordId: string | null;
				battletag: null;
				discordSyncedAt: null;
			};
		}): Promise<unknown>;
	};
	quarantineConfig: {
		findUnique(args: {
			where: { guildId: string };
			select: { battlenetRequired: true };
		}): Promise<{ battlenetRequired: boolean } | null>;
	};
	quarantineStatus: {
		findUnique(args: {
			where: { guildId_userId: { guildId: string; userId: string } };
		}): Promise<{
			acceptedAt: Date | null;
			battlenetVerifiedAt: Date | null;
			releasedAt?: Date | null;
		} | null>;
		update(args: {
			where: { guildId_userId: { guildId: string; userId: string } };
			data: { battlenetVerifiedAt: null; discordSyncedAt: null };
		}): Promise<unknown>;
	};
}

export type BattlenetUnlinkAuthor =
	| { appUserId: string }
	| { discordUserId: string };

export type BattlenetUnlinkResult = "aucun-lien" | "delie" | "libere";

/**
 * Delie le compte Battle.net d'un membre.
 *
 * Sans `release`, le lien actif devient une **trace** : le compte Blizzard ne
 * pourra pas servir a un autre compte Discord pendant la duree de
 * conservation. `discordSyncedAt` repasse a `null` pour que le bot annonce la
 * deliaison (journal, et message prive si ce n'est pas le membre qui a delie).
 *
 * Avec `release`, toutes les lignes du membre disparaissent, traces comprises :
 * le compte Blizzard redevient libre. Rien n'est plus a annoncer, il ne reste
 * aucune ligne a ramasser — c'est a l'appelant de journaliser.
 *
 * Le membre **garde son acces** s'il est deja libere de la quarantaine ; s'il
 * ne l'est pas, il perd l'etape de verification (voir
 * `battlenetUnlinkResetsVerification`), et le rattrapage du bot retire les
 * roles qu'elle avait poses.
 *
 * Le role « BattleTag verifie » n'est pas touche : le bot le fait suivre les
 * liens actifs en continu.
 *
 * Un auteur Discord doit exister dans `discord_users` (cle etrangere) :
 * l'appelant l'enregistre avant.
 */
export async function unlinkBattlenet(
	db: Db,
	params: {
		guildId: string;
		userId: string;
		author: BattlenetUnlinkAuthor;
		release: boolean;
	},
): Promise<BattlenetUnlinkResult> {
	const { guildId, userId, author, release } = params;

	const lignes = await db.battlenetAccount.findMany({ where: { userId } });
	const actif = lignes.find((ligne) => ligne.unlinkedAt === null);

	if (release ? lignes.length === 0 : !actif) return "aucun-lien";

	if (release) {
		await db.battlenetAccount.deleteMany({ where: { userId } });
	} else {
		await db.battlenetAccount.update({
			where: { battlenetHash: actif!.battlenetHash },
			data: {
				unlinkedAt: new Date(),
				unlinkedById: "appUserId" in author ? author.appUserId : null,
				unlinkedByDiscordId: "discordUserId" in author ? author.discordUserId : null,
				battletag: null,
				discordSyncedAt: null,
			},
		});
	}

	if (actif) await reculerQuarantaine(db, guildId, userId);

	return release ? "libere" : "delie";
}

async function reculerQuarantaine(db: Db, guildId: string, userId: string): Promise<void> {
	const [config, statut] = await Promise.all([
		db.quarantineConfig.findUnique({
			where: { guildId },
			select: { battlenetRequired: true },
		}),
		db.quarantineStatus.findUnique({
			where: { guildId_userId: { guildId, userId } },
		}),
	]);

	if (!statut?.battlenetVerifiedAt) return;
	const etape = quarantineStage(statut, config?.battlenetRequired ?? false);
	if (!battlenetUnlinkResetsVerification(etape)) return;

	// `discordSyncedAt` a `null` : le bot rejoue l'etape et retire les roles que
	// la verification avait poses.
	await db.quarantineStatus.update({
		where: { guildId_userId: { guildId, userId } },
		data: { battlenetVerifiedAt: null, discordSyncedAt: null },
	});
}
