import {
	DEFAULT_MENTION_MEMBERS,
	GuildRoleKey,
	MentionSettingKey,
	renderMemberReference,
} from "@anubis/shared";
import prisma from "../prisma";
import * as guildConfig from "../collectors/guildConfig";

/**
 * Qui le bot interpelle, et comment.
 *
 * Deux reglages differents vivent ici parce qu'ils lisent la meme table et se
 * lisent au meme rythme : le role interpelle quand le staff doit venir, et la
 * facon d'ecrire un membre dans les journaux.
 *
 * Meme cache de 30 secondes que l'automod et les annonces d'experience : un
 * journal de vocaux peut recevoir plusieurs entrees par seconde, et interroger
 * la base pour chaque nom serait une requete par ligne.
 */

const CACHE_MS = 30_000;

interface Entree {
	mentionne: boolean;
	roleAlerte: string | null;
	expire: number;
}

const cache = new Map<string, Entree>();

async function reglages(guildId: string): Promise<Entree> {
	const connue = cache.get(guildId);
	if (connue && connue.expire > Date.now()) return connue;

	const [brut, cleRole] = await Promise.all([
		guildConfig.getConfig(guildId, MentionSettingKey.LOG_MEMBERS),
		guildConfig.getConfig(guildId, MentionSettingKey.ALERT_ROLE),
	]);

	// Une cle inconnue vaut « aucun role » : la table reste modifiable a la
	// main, et une faute de frappe ne doit pas poser une mention au hasard.
	const connues: string[] = Object.values(GuildRoleKey);
	const roleAlerte =
		cleRole && connues.includes(cleRole)
			? await guildConfig.getConfig(guildId, cleRole)
			: null;

	const entree: Entree = {
		mentionne: brut === null ? DEFAULT_MENTION_MEMBERS : brut === "true",
		roleAlerte,
		expire: Date.now() + CACHE_MS,
	};

	cache.set(guildId, entree);
	return entree;
}

/** A appeler apres une ecriture du bot lui-meme sur ces cles. */
export function oublierReglages(guildId: string): void {
	cache.delete(guildId);
}

/**
 * Reference d'un membre pour un journal : mention, ou « pseudo | identifiant ».
 *
 * Le pseudo est relu dans le referentiel quand l'appelant ne l'a pas sous la
 * main. Un membre jamais croise par le referentiel n'a pas de pseudo connu :
 * l'identifiant seul reste alors ecrit, ce qui suffit a le retrouver.
 */
export async function referenceMembre(
	guildId: string,
	userId: string,
	username?: string | null,
): Promise<string> {
	const { mentionne } = await reglages(guildId);
	if (mentionne) return renderMemberReference(userId, null, true);

	const connu =
		username ??
		(
			await prisma.discordUser.findUnique({
				where: { id: userId },
				select: { username: true },
			})
		)?.username ??
		null;

	return renderMemberReference(userId, connu, false);
}

/**
 * Identifiant du role a interpeller quand le staff doit venir : ouverture d'un
 * ticket, signalement dans un salon vocal.
 *
 * `null` quand aucun role n'est choisi, ou quand la cle choisie ne porte aucun
 * identifiant — l'API refuse deja ce cas, mais la table se modifie aussi a la
 * main depuis la page Configurations.
 */
export async function roleDAlerte(guildId: string): Promise<string | null> {
	return (await reglages(guildId)).roleAlerte;
}
