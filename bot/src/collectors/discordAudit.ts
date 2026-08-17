import {
	AuditLogEvent,
	PermissionFlagsBits,
	type Client,
	type Guild,
	type GuildAuditLogsEntry,
} from "discord.js";
import * as referentiel from "./referentiel";

/**
 * Lecture de l'audit log Discord.
 *
 * C'est la seule source qui donne l'auteur reel d'un bannissement, d'une
 * expulsion ou d'une exclusion temporaire posee a la main dans le client : les
 * evenements de passerelle (`guildBanAdd`, `guildMemberRemove`,
 * `guildMemberUpdate`) disent ce qui est arrive, jamais qui l'a fait.
 */

/**
 * Ecart maximal tolere entre l'evenement recu et l'entree d'audit.
 *
 * Au-dela, on considere que l'entree trouvee correspond a une action
 * anterieure sur la meme personne — un membre re-banni le lendemain ne doit
 * pas heriter de l'auteur du bannissement precedent.
 */
const FENETRE_MS = 20_000;

/**
 * L'audit log est alimente de facon asynchrone : l'entree n'existe souvent pas
 * encore au moment ou la passerelle livre l'evenement. On reessaie brievement
 * plutot que de conclure a une action anonyme.
 */
const TENTATIVES = 4;
const DELAI_ENTRE_TENTATIVES_MS = 700;

/**
 * Entrees deja consommees.
 *
 * Un bannissement declenche `guildBanAdd` *et* `guildMemberRemove` : sans ce
 * garde, la meme entree d'audit servirait a enregistrer deux sanctions.
 */
const entreesTraitees = new Set<string>();
const MAX_ENTREES_MEMORISEES = 1000;

/** Signale une seule fois l'absence de permission, plutot qu'a chaque evenement. */
const permissionSignalee = new Set<string>();

export interface ActionAuditee {
	entryId: string;
	/**
	 * Auteur reel de l'action ; `null` si Discord ne le fournit pas.
	 *
	 * Seul l'identifiant est expose : l'audit log peut ne renvoyer qu'un
	 * utilisateur partiel, inexploitable pour ecrire une fiche complete.
	 * `garantirAuteur` se charge de le resoudre quand c'est necessaire.
	 */
	executorId: string | null;
	/** Libelle lisible pour les journaux, quand il est disponible. */
	executorTag: string | null;
	reason: string | null;
	createdAt: Date;
	changes: { key: string; old: unknown; new: unknown }[];
}

function memoriser(entryId: string): void {
	entreesTraitees.add(entryId);

	// Purge grossiere : on ne garde que les entrees recentes, les anciennes ne
	// peuvent plus etre rattachees a un evenement (voir FENETRE_MS).
	if (entreesTraitees.size > MAX_ENTREES_MEMORISEES) {
		const ancienne = entreesTraitees.values().next().value;
		if (ancienne) entreesTraitees.delete(ancienne);
	}
}

function attendre(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cherche l'entree d'audit correspondant a une action sur un membre.
 *
 * Renvoie `null` quand rien ne correspond : l'action est alors enregistree
 * sans auteur plutot que d'etre ignoree — mieux vaut une sanction anonyme
 * qu'une sanction absente.
 */
export async function chercherAction(
	guild: Guild,
	type: AuditLogEvent,
	targetId: string,
	/**
	 * Filtre supplementaire. `MemberUpdate` couvre aussi bien un changement de
	 * surnom qu'une exclusion temporaire : sans discriminant, on attribuerait
	 * a la mauvaise action.
	 */
	accepte?: (action: ActionAuditee) => boolean,
): Promise<ActionAuditee | null> {
	const bot = guild.members.me;

	if (!bot?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
		if (!permissionSignalee.has(guild.id)) {
			permissionSignalee.add(guild.id);
			console.warn(
				`[Audit] Permission "Voir le journal d'audit" absente sur ${guild.name} : ` +
					"les sanctions posées à la main seront enregistrées sans auteur.",
			);
		}
		return null;
	}

	for (let tentative = 0; tentative < TENTATIVES; tentative++) {
		if (tentative > 0) await attendre(DELAI_ENTRE_TENTATIVES_MS);

		let entrees;
		try {
			const journal = await guild.fetchAuditLogs({ type, limit: 10 });
			entrees = [...journal.entries.values()];
		} catch (err) {
			console.error(
				"[Audit] Lecture du journal Discord impossible :",
				err,
			);
			return null;
		}

		const candidats: ActionAuditee[] = entrees
			.filter(
				(entree: GuildAuditLogsEntry) =>
					entree.targetId === targetId &&
					!entreesTraitees.has(entree.id) &&
					Date.now() - entree.createdTimestamp < FENETRE_MS,
			)
			.map((entree: GuildAuditLogsEntry) => ({
				entryId: entree.id,
				executorId: entree.executorId,
				executorTag: entree.executor?.tag ?? null,
				reason: entree.reason,
				createdAt: entree.createdAt,
				changes: entree.changes.map((changement) => ({
					key: changement.key,
					old: changement.old,
					new: changement.new,
				})),
			}));

		const correspondance = candidats.find(
			(action) => !accepte || accepte(action),
		);

		if (correspondance) {
			memoriser(correspondance.entryId);
			return correspondance;
		}
	}

	return null;
}

/**
 * Garantit que l'auteur d'une action existe en base avant qu'une sanction ne
 * le reference.
 *
 * `sanctions.moderator_id` porte une cle etrangere vers `discord_users` :
 * enregistrer un moderateur jamais vu par le bot echouerait. L'audit log ne
 * fournissant parfois qu'un utilisateur partiel, on le resout par le cache du
 * client.
 *
 * Renvoie l'identifiant a stocker, ou `null` si l'auteur reste introuvable.
 */
export async function garantirAuteur(
	client: Client,
	executorId: string | null,
): Promise<string | null> {
	if (!executorId) return null;

	const utilisateur = await client.users.fetch(executorId).catch(() => null);
	if (!utilisateur) return null;

	await referentiel.upsertUser(utilisateur);
	return utilisateur.id;
}

export { AuditLogEvent };
