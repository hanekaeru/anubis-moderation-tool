import { QuarantineStage } from "./dto/quarantine";

/**
 * Regles de conservation et de deliaison de la verification Battle.net.
 *
 * Partagees parce que trois chemins les appliquent — l'API (callback et
 * deliaison depuis le dashboard), le bot (commandes, purge) et le dashboard
 * (affichage) — et qu'une duree recopiee a trois endroits finit par diverger.
 */

/**
 * Duree de vie du BattleTag, la seule donnee Blizzard gardee en clair.
 *
 * Les conditions d'utilisation des API Blizzard imposent une conservation de
 * 30 jours au plus. Rien ne repose sur le BattleTag — l'unicite porte sur
 * l'empreinte —, et c'est justement pendant ce premier mois qu'un arrivant
 * suspect interesse l'equipe.
 */
export const BATTLENET_BATTLETAG_RETENTION_DAYS = 30;

/**
 * Conservation d'un lien ou d'une trace apres le depart du membre ou la
 * deliaison. Assez longue pour attraper le retour d'un banni sur un compte
 * secondaire ; a ecrire dans la politique de confidentialite, qui la justifie.
 */
export const BATTLENET_LINK_RETENTION_DAYS = 365;

/**
 * Delai entre deux demandes de lien par le meme membre. Chaque demande ecrit
 * une ligne `battlenet_verification_states` : sans delai, on en cree en boucle.
 */
export const BATTLENET_LINK_COOLDOWN_SECONDS = 30;

const JOUR_MS = 86_400_000;

/** BattleTag arrive au terme de sa conservation. */
export function battletagExpired(verifiedAt: Date, now: Date = new Date()): boolean {
	return now.getTime() - verifiedAt.getTime() >= BATTLENET_BATTLETAG_RETENTION_DAYS * JOUR_MS;
}

/** Ce que la purge doit savoir d'un lien pour decider de le supprimer. */
export interface BattlenetRetentionFacts {
	/** Deliaison : la ligne n'est plus qu'une trace. */
	unlinkedAt: Date | null;
	/** Depart du serveur, `null` tant que le membre y est. */
	leftAt: Date | null;
	/** Un bannissement est en cours : rien ne s'efface tant qu'il dure. */
	banActive: boolean;
	/** Fin du dernier bannissement termine (expire ou leve), `null` sans. */
	banEndedAt: Date | null;
}

/**
 * Lien ou trace arrive au terme de sa conservation.
 *
 * Le delai part de l'evenement **le plus recent** parmi la deliaison, le depart
 * et la fin d'un bannissement : un banni est precisement celui qui revient sur
 * un compte secondaire, son lien doit donc survivre a toute la sanction, puis
 * aux douze mois. Un lien actif d'un membre toujours present ne s'efface
 * jamais — il sert encore.
 */
export function battlenetLinkExpired(
	facts: BattlenetRetentionFacts,
	now: Date = new Date(),
): boolean {
	if (facts.banActive) return false;
	if (facts.unlinkedAt === null && facts.leftAt === null) return false;

	const reperes = [facts.unlinkedAt, facts.leftAt, facts.banEndedAt]
		.filter((date): date is Date => date !== null)
		.map((date) => date.getTime());

	return now.getTime() - Math.max(...reperes) >= BATTLENET_LINK_RETENTION_DAYS * JOUR_MS;
}

/**
 * La deliaison doit-elle faire reculer l'etape de quarantaine ?
 *
 * Un membre deja libere **garde son acces** : la date de verification reste,
 * comme un historique, sans quoi le dashboard l'afficherait en attente alors que
 * le bot ne lui retire rien. Un membre encore en quarantaine perd l'etape — sinon
 * il delierait, accepterait le reglement, et entrerait sans aucun lien.
 */
export function battlenetUnlinkResetsVerification(stage: QuarantineStage): boolean {
	return stage !== QuarantineStage.CLEARED;
}

/**
 * Phrase d'information montree **avant** la connexion chez Blizzard.
 *
 * Les conditions de Blizzard (§2(p)) et le RGPD exigent d'informer le membre
 * avant la collecte ; Blizzard demande aussi d'etre cite comme source des
 * donnees (§2(m)). « Empreinte » plutot que « hachage » : le texte s'adresse a
 * tout le monde.
 */
export const BATTLENET_PRIVACY_NOTICE =
	"Le serveur conserve une empreinte de ton compte Battle.net (pas ton identifiant) " +
	"pour empêcher les doubles comptes, et ton BattleTag pendant " +
	`${BATTLENET_BATTLETAG_RETENTION_DAYS} jours. Données fournies par Blizzard Entertainment ; ` +
	"ce serveur n'est pas affilié à Blizzard.";
