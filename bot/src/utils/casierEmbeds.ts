import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	type APIEmbedField,
	type ColorResolvable,
	type User,
} from "discord.js";
import {
	SANCTION_STATUS_LABELS,
	SANCTION_TYPE_LABELS,
	WARNING_SEVERITY_LABELS,
	formatDurationSeconds,
} from "@anubis/shared";
import type { Casier, CasierEntry } from "../collectors/casier";
import { danger, info, warning } from "./constantes";

/**
 * Rendu du casier : un seul embed par page, une entree par champ.
 *
 * Separe de la commande pour rester verifiable sans simuler une interaction
 * Discord — c'est ici que vivent les regles de troncature, les seules qui
 * peuvent faire echouer la reponse a l'execution.
 *
 * Un embed unique n'a qu'une couleur : la distinction entre sanction,
 * avertissement et note passe donc par l'emoji et le libelle de chaque champ,
 * la couleur de l'embed refletant le type le plus grave present sur la page.
 */

/** Entrees affichees par page. Discord plafonne un embed a 25 champs. */
export const PAR_PAGE = 10;

/**
 * Budget de caracteres pour l'embed.
 *
 * Discord refuse le message au-dela de 6000 caracteres cumules (titre, auteur,
 * description, champs, pied). `longueurTotale` compte exactement ce que l'on
 * produit, la marge restante est donc reelle.
 */
export const BUDGET_EMBED = 5600;

/** Un champ d'embed ne peut pas depasser 1024 caracteres de valeur. */
const MAX_VALEUR_CHAMP = 1024;

/**
 * Paliers de troncature, du plus confortable au plus serre.
 *
 * Un casier de dix notes de 4000 caracteres depasserait la limite meme apres
 * une premiere coupe : on resserre jusqu'a tenir, plutot que d'esperer.
 */
const PALIERS_COUPE = [300, 180, 100, 50];

const EMOJI: Record<CasierEntry["kind"], string> = {
	SANCTION: "⛔",
	WARNING: "⚠️",
	NOTE: "📝",
};

export interface PageRendue {
	embeds: EmbedBuilder[];
	components: ActionRowBuilder<ButtonBuilder>[];
}

/** Texte libre saisi par un moderateur : mis a plat sur une ligne, puis coupe. */
function tronquer(texte: string, max: number): string {
	const propre = texte.replace(/\s+/g, " ").trim();
	return propre.length <= max ? propre : `${propre.slice(0, max - 1)}…`;
}

/**
 * Ecretage de securite sur une valeur deja composee.
 *
 * Contrairement a `tronquer`, ne touche pas aux espaces : la valeur d'un champ
 * est multiligne, et les aplatir collerait toutes les informations ensemble.
 */
function ecreter(texte: string, max: number): string {
	return texte.length <= max ? texte : `${texte.slice(0, max - 1)}…`;
}

/** Horodatage rendu dans le fuseau de chaque lecteur, pas celui du serveur. */
function horodatage(date: Date, style: "f" | "R" = "f"): string {
	return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

/**
 * Auteur d'une action : moderateur Discord (commande du bot) ou compte
 * dashboard (saisie web). La mention est preferee quand elle existe, elle reste
 * cliquable dans Discord.
 */
function auteur(
	moderator: { id: string } | null,
	createdBy: { displayName: string } | null,
): string {
	if (moderator) return `<@${moderator.id}>`;
	if (createdBy) return `${createdBy.displayName} *(dashboard)*`;
	return "*Systeme*";
}

/**
 * Auteur d'une levee.
 *
 * Distinct de `auteur` sur un seul point, mais qui compte : sans auteur connu,
 * une levee n'est pas l'oeuvre du « Systeme ». Le cas se produit pour les
 * levees faites a la main dans Discord dont l'audit log n'a rien donne (droit
 * absent, entree expiree), et pour celles enregistrees avant que la colonne
 * n'existe.
 */
function auteurLevee(
	revokedByDiscord: { id: string } | null,
	revokedBy: { displayName: string } | null,
): string {
	if (!revokedByDiscord && !revokedBy) return "*auteur inconnu*";
	return auteur(revokedByDiscord, revokedBy);
}

/** Date courte, pour le nom du champ ou `<t:>` n'est pas interprete. */
function dateCourte(date: Date): string {
	return date.toLocaleDateString("fr-FR", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});
}

function champSanction(
	entry: Extract<CasierEntry, { kind: "SANCTION" }>,
	coupe: number,
): APIEmbedField {
	const s = entry.data;
	const lignes = [
		tronquer(s.reason, coupe),
		`**Par** ${auteur(s.moderator, s.createdBy)} le ${horodatage(s.startsAt)}` +
			` · **Durée** ${formatDurationSeconds(s.durationSeconds)}` +
			(s.expiresAt ? ` · **Echeance** ${horodatage(s.expiresAt)}` : ""),
	];

	const statut = [`**Statut** ${SANCTION_STATUS_LABELS[s.status]}`];
	if (s.revokedAt) {
		statut.push(`levée le ${horodatage(s.revokedAt)}`);
		// L'auteur vient de Discord (`/unban`, geste manuel) ou du dashboard :
		// le meme rendu que pour l'auteur de la sanction, plutot que deux
		// formes selon la provenance.
		statut.push(`par ${auteurLevee(s.revokedByDiscord, s.revokedBy)}`);
		if (s.revokeReason) statut.push(`— ${tronquer(s.revokeReason, 100)}`);
	}
	lignes.push(statut.join(" "));

	// Sanction automatique : le message est supprime de Discord des le
	// declenchement, l'incident en garde la seule copie. Sans cette ligne, le
	// casier n'annonce que « Automod : Filtre de mots », sans ce qui a ete ecrit.
	if (s.automodIncident) {
		const contenu = s.automodIncident.messageContent;
		lignes.push(
			`**Message supprimé** ${
				contenu ? tronquer(contenu, coupe) : "*(sans texte)*"
			}`,
		);
	}

	if (s.evidenceUrl) lignes.push(`**Preuve** ${s.evidenceUrl}`);

	return {
		name: `${EMOJI.SANCTION} Sanction — ${SANCTION_TYPE_LABELS[s.type]} · ${dateCourte(s.createdAt)}`,
		value: ecreter(lignes.join("\n"), MAX_VALEUR_CHAMP),
		inline: false,
	};
}

function champAvertissement(
	entry: Extract<CasierEntry, { kind: "WARNING" }>,
	coupe: number,
): APIEmbedField {
	const w = entry.data;
	const actif =
		!w.revokedAt && (!w.expiresAt || w.expiresAt.getTime() > Date.now());

	const lignes = [
		tronquer(w.reason, coupe),
		`**Par** ${auteur(w.moderator, w.createdBy)} le ${horodatage(w.createdAt)}` +
			` · **Poids** ${w.points} pt` +
			(w.expiresAt ? ` · **Expire** ${horodatage(w.expiresAt)}` : ""),
	];

	const statut = [
		`**Statut** ${actif ? "En cours" : w.revokedAt ? "Levé" : "Expiré"}`,
	];
	if (w.revokedAt) {
		statut.push(`le ${horodatage(w.revokedAt)}`);
		// Un avertissement ne se leve que depuis le dashboard : pas
		// d'equivalent Discord a chercher ici, contrairement aux sanctions.
		statut.push(`par ${auteurLevee(null, w.revokedBy)}`);
		if (w.revokeReason) statut.push(`— ${tronquer(w.revokeReason, 100)}`);
	}
	lignes.push(statut.join(" "));

	return {
		name: `${EMOJI.WARNING} Avertissement — ${WARNING_SEVERITY_LABELS[w.severity]} · ${dateCourte(w.createdAt)}`,
		value: ecreter(lignes.join("\n"), MAX_VALEUR_CHAMP),
		inline: false,
	};
}

function champNote(
	entry: Extract<CasierEntry, { kind: "NOTE" }>,
	coupe: number,
): APIEmbedField {
	const n = entry.data;
	const lignes = [
		tronquer(n.body, coupe),
		`**Par** ${n.author.displayName} *(dashboard)* le ${horodatage(n.createdAt)}` +
			// `updatedAt` bouge a chaque ecriture : ne le signaler que s'il s'ecarte
			// reellement de la creation, sinon toute note paraitrait modifiee.
			(n.updatedAt.getTime() - n.createdAt.getTime() > 1000
				? ` · **Modifiée** ${horodatage(n.updatedAt)}`
				: ""),
	];

	return {
		name: `${EMOJI.NOTE} Note${n.pinned ? " épinglée" : ""} · ${dateCourte(n.createdAt)}`,
		value: ecreter(lignes.join("\n"), MAX_VALEUR_CHAMP),
		inline: false,
	};
}

function construireChamp(entry: CasierEntry, coupe: number): APIEmbedField {
	switch (entry.kind) {
		case "SANCTION":
			return champSanction(entry, coupe);
		case "WARNING":
			return champAvertissement(entry, coupe);
		case "NOTE":
			return champNote(entry, coupe);
	}
}

/** La couleur suit le type le plus grave affiche sur la page. */
function couleurDeLaPage(entries: CasierEntry[]): ColorResolvable {
	if (entries.some((entry) => entry.kind === "SANCTION")) return danger;
	if (entries.some((entry) => entry.kind === "WARNING")) return warning;
	return info;
}

export function longueurTotale(embed: EmbedBuilder): number {
	const json = embed.toJSON();
	const champs = (json.fields ?? []).reduce(
		(total, champ) => total + champ.name.length + champ.value.length,
		0,
	);

	return (
		champs +
		(json.title?.length ?? 0) +
		(json.description?.length ?? 0) +
		(json.author?.name.length ?? 0) +
		(json.footer?.text.length ?? 0)
	);
}

function enTete(casier: Casier): string {
	const { sanctions, warnings, notes } = casier.counts;
	const lignes = [
		`${EMOJI.SANCTION} **${sanctions}** sanction(s) · ` +
			`${EMOJI.WARNING} **${warnings}** avertissement(s) · ` +
			`${EMOJI.NOTE} **${notes}** note(s)`,
		`-# ${casier.entries.length} entrée(s), de la plus récente a la plus ancienne.`,
	];

	if (casier.truncated) {
		lignes.push(
			"-# Casier volumineux : seules les entrées les plus récentes sont affichées.",
		);
	}

	return lignes.join("\n");
}

/**
 * Construit l'embed d'une page en respectant le budget global.
 *
 * Une note peut faire 4000 caracteres a elle seule : dix d'affilee
 * depasseraient la limite de Discord et feraient echouer la reponse entiere.
 * On tente la coupe la plus confortable, puis on resserre tant que ca ne tient
 * pas — le dernier palier tient toujours, le cout fixe par entree etant borne.
 */
export function embedDeLaPage(
	cible: User,
	casier: Casier,
	entries: CasierEntry[],
	page: number,
	total: number,
): EmbedBuilder {
	const construire = (coupe: number): EmbedBuilder =>
		new EmbedBuilder()
			.setColor(couleurDeLaPage(entries))
			.setAuthor({
				name: `Casier de ${cible.tag}`,
				iconURL: cible.displayAvatarURL(),
			})
			.setDescription(enTete(casier))
			.addFields(entries.map((entry) => construireChamp(entry, coupe)))
			.setFooter({ text: `${cible.id} · page ${page + 1} sur ${total}` });

	let embed = construire(PALIERS_COUPE[0]!);

	for (const coupe of PALIERS_COUPE.slice(1)) {
		if (longueurTotale(embed) <= BUDGET_EMBED) break;
		embed = construire(coupe);
	}

	return embed;
}

export function boutons(
	page: number,
	total: number,
): ActionRowBuilder<ButtonBuilder> {
	const premierePage = page === 0;
	const dernierePage = page >= total - 1;

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId("casier:first")
			.setEmoji("⏮")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(premierePage),
		new ButtonBuilder()
			.setCustomId("casier:prev")
			.setEmoji("◀")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(premierePage),
		// Bouton desactive servant d'indicateur : une rangee de composants
		// Discord n'accepte pas d'element de texte libre.
		new ButtonBuilder()
			.setCustomId("casier:page")
			.setLabel(`Page ${page + 1} / ${total}`)
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(true),
		new ButtonBuilder()
			.setCustomId("casier:next")
			.setEmoji("▶")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(dernierePage),
		new ButtonBuilder()
			.setCustomId("casier:last")
			.setEmoji("⏭")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(dernierePage),
	);
}

export function nombreDePages(casier: Casier): number {
	return Math.max(1, Math.ceil(casier.entries.length / PAR_PAGE));
}

export function rendrePage(
	cible: User,
	casier: Casier,
	page: number,
	total: number,
): PageRendue {
	const debut = page * PAR_PAGE;
	const entries = casier.entries.slice(debut, debut + PAR_PAGE);

	return {
		embeds: [embedDeLaPage(cible, casier, entries, page, total)],
		components: total > 1 ? [boutons(page, total)] : [],
	};
}
