import {
	FileUploadBuilder,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	type Attachment,
	type ModalSubmitInteraction,
	type User,
} from "discord.js";
import {
	MAX_MODERATION_ATTACHMENTS,
	MAX_MODERATION_ATTACHMENT_BYTES,
	MODERATION_ATTACHMENT_CONTENT_TYPES,
	SANCTION_STATUS_LABELS,
	SANCTION_TYPE_LABELS,
} from "@anubis/shared";
import prisma from "../prisma";
import { upsertUser } from "../collectors/referentiel";

/**
 * Depot de preuves sur une sanction, depuis Discord (`/preuve`).
 *
 * Le formulaire tient dans une seule modale : le choix de la sanction et les
 * deux zones de fichiers y cohabitent, ce qui evite l'aller-retour
 * « select puis modale » et son lot d'interactions expirees.
 *
 * Deux zones de transfert plutot qu'une case a cocher : un depot melange
 * couramment une capture anodine et une image penible, et une case unique
 * forcerait a marquer les deux ou aucune. Les fichiers de la seconde zone
 * arrivent avec `spoiler = true` et restent masques dans la webapp.
 */

/** Prefixe du `customId` de la modale ; l'identifiant du membre vise le suit. */
export const EVIDENCE_MODAL_PREFIX = "preuve:modal:";

const CHAMP_SANCTION = "preuve:sanction";
const CHAMP_FICHIERS = "preuve:fichiers";
const CHAMP_FICHIERS_SPOILER = "preuve:fichiers-spoiler";

/** Discord plafonne un select a 25 options. */
const MAX_SANCTIONS_PROPOSEES = 25;

/** Une option de select ne depasse pas 100 caracteres, libelle comme description. */
const MAX_TEXTE_OPTION = 100;

export interface SanctionChoisissable {
	id: string;
	type: string;
	status: string;
	reason: string;
	createdAt: Date;
}

/**
 * Sanctions proposees au depot : les plus recentes d'abord.
 *
 * Les revoquees restent proposees — une preuve peut arriver apres coup pour
 * justifier a posteriori une decision contestee, et c'est precisement le cas
 * ou elle compte le plus.
 */
export async function fetchSanctionsChoisissables(
	guildId: string,
	userId: string,
): Promise<SanctionChoisissable[]> {
	return prisma.sanction.findMany({
		where: { guildId, userId },
		orderBy: { createdAt: "desc" },
		take: MAX_SANCTIONS_PROPOSEES,
		select: {
			id: true,
			type: true,
			status: true,
			reason: true,
			createdAt: true,
		},
	});
}

function couper(texte: string, max = MAX_TEXTE_OPTION): string {
	return texte.length <= max ? texte : `${texte.slice(0, max - 1)}…`;
}

/** Libelle d'une sanction dans le select : type, date et statut. */
function libelleSanction(sanction: SanctionChoisissable): string {
	const type =
		SANCTION_TYPE_LABELS[
			sanction.type as keyof typeof SANCTION_TYPE_LABELS
		] ?? sanction.type;
	const statut =
		SANCTION_STATUS_LABELS[
			sanction.status as keyof typeof SANCTION_STATUS_LABELS
		] ?? sanction.status;
	const date = sanction.createdAt.toLocaleDateString("fr-FR", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});

	return couper(`${type} — ${date} (${statut})`);
}

export function buildEvidenceModal(
	cible: User,
	sanctions: SanctionChoisissable[],
): ModalBuilder {
	const options = sanctions.map((sanction) =>
		new StringSelectMenuOptionBuilder()
			.setLabel(libelleSanction(sanction))
			.setDescription(couper(sanction.reason))
			.setValue(sanction.id),
	);

	return new ModalBuilder()
		.setCustomId(`${EVIDENCE_MODAL_PREFIX}${cible.id}`)
		.setTitle(couper(`Preuves — ${cible.username}`, 45))
		.addLabelComponents(
			new LabelBuilder()
				.setLabel("Sanction concernée")
				.setStringSelectMenuComponent(
					new StringSelectMenuBuilder()
						.setCustomId(CHAMP_SANCTION)
						.setPlaceholder("Choisir la sanction à documenter")
						.addOptions(options),
				),
			// Le plafond est rappele dans les deux descriptions : Discord ne
			// controle `maxValues` que zone par zone, et rien ne l'empeche donc
			// d'accepter deux fois le plafond. Le dire avant le choix des
			// fichiers est le seul garde-fou possible cote client.
			new LabelBuilder()
				.setLabel("Preuves")
				.setDescription(
					`Visibles sur la fiche du membre. ${MAX_MODERATION_ATTACHMENTS} au total, les deux zones réunies.`,
				)
				.setFileUploadComponent(
					new FileUploadBuilder()
						.setCustomId(CHAMP_FICHIERS)
						.setMaxValues(MAX_MODERATION_ATTACHMENTS)
						.setRequired(false),
				),
			new LabelBuilder()
				.setLabel("Preuves sensibles")
				.setDescription(
					`Masquées jusqu'à un clic du staff. Comptent dans les mêmes ${MAX_MODERATION_ATTACHMENTS} places.`,
				)
				.setFileUploadComponent(
					new FileUploadBuilder()
						.setCustomId(CHAMP_FICHIERS_SPOILER)
						.setMaxValues(MAX_MODERATION_ATTACHMENTS)
						.setRequired(false),
				),
		);
}

/**
 * Type MIME sans ses parametres.
 *
 * Discord renvoie couramment `text/plain; charset=utf-8` : compare tel quel a
 * la liste blanche, un simple fichier texte serait refuse.
 */
function typeSimple(contentType: string | null): string {
	return (contentType ?? "application/octet-stream").split(";")[0]!.trim();
}

interface PreuveTelechargee {
	fileName: string;
	contentType: string;
	size: number;
	data: Buffer;
	spoiler: boolean;
}

/** Motif de rejet d'un fichier, pour le compte-rendu au moderateur. */
type Rejet = { fileName: string; raison: string };

async function telecharger(
	attachment: Attachment,
	spoiler: boolean,
	rejets: Rejet[],
): Promise<PreuveTelechargee | null> {
	const contentType = typeSimple(attachment.contentType);

	// Les deux controles sont refaits par l'API sur son propre chemin ; ici ils
	// evitent surtout de telecharger pour rien un fichier qui finirait refuse.
	if (attachment.size > MAX_MODERATION_ATTACHMENT_BYTES) {
		rejets.push({
			fileName: attachment.name,
			raison: `au-delà de ${Math.floor(MAX_MODERATION_ATTACHMENT_BYTES / 1024 / 1024)} Mo`,
		});
		return null;
	}

	if (
		!(MODERATION_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(
			contentType,
		)
	) {
		rejets.push({
			fileName: attachment.name,
			raison: `type non accepte (${contentType})`,
		});
		return null;
	}

	try {
		const response = await fetch(attachment.url);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const data = Buffer.from(await response.arrayBuffer());
		return {
			fileName: attachment.name.slice(0, 255),
			contentType,
			size: data.byteLength,
			data,
			spoiler,
		};
	} catch (err) {
		console.error(
			`[Preuves] Téléchargement de "${attachment.name}" échoué :`,
			err,
		);
		rejets.push({ fileName: attachment.name, raison: "téléchargement échoué" });
		return null;
	}
}

/** Un fichier par ligne, pour le compte-rendu ephemere. */
function listerRejets(rejets: Rejet[]): string {
	return rejets
		.map((rejet) => `• \`${rejet.fileName}\` — ${rejet.raison}`)
		.join("\n");
}

export async function handleEvidenceModal(
	interaction: ModalSubmitInteraction,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	// Le telechargement des fichiers depasse largement les trois secondes
	// accordees a une reponse directe.
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const sanctionId = interaction.fields.getStringSelectValues(
		CHAMP_SANCTION,
	)[0];

	if (!sanctionId) {
		await interaction.editReply("Aucune sanction sélectionnée.");
		return;
	}

	const normales =
		interaction.fields.getUploadedFiles(CHAMP_FICHIERS) ?? new Map();
	const sensibles =
		interaction.fields.getUploadedFiles(CHAMP_FICHIERS_SPOILER) ?? new Map();

	const proposes = [
		...[...normales.values()].map((file) => ({ file, spoiler: false })),
		...[...sensibles.values()].map((file) => ({ file, spoiler: true })),
	];

	if (!proposes.length) {
		await interaction.editReply(
			"Aucun fichier joint : la sanction n'a pas été modifiée.",
		);
		return;
	}

	// La sanction est relue avec son serveur : le `customId` vient du client et
	// ne prouve rien. Sans ce controle, un identifiant recopie permettrait de
	// deposer une preuve sur la sanction d'un autre serveur.
	const sanction = await prisma.sanction.findFirst({
		where: { id: sanctionId, guildId: interaction.guildId },
		select: { id: true },
	});

	if (!sanction) {
		await interaction.editReply("Sanction introuvable sur ce serveur.");
		return;
	}

	const dejaPresentes = await prisma.moderationAttachment.count({
		where: { sanctionId: sanction.id },
	});
	const place = MAX_MODERATION_ATTACHMENTS - dejaPresentes;

	if (place <= 0) {
		await interaction.editReply(
			`Cette sanction porte déjà ${MAX_MODERATION_ATTACHMENTS} pièces jointes, le maximum.`,
		);
		return;
	}

	// Rien n'est enregistre quand le depot deborde, plutot que de garder les
	// premiers fichiers venus.
	//
	// Discord ne fait respecter `maxValues` que composant par composant : les
	// deux zones reunies laissent toujours proposer le double du plafond, et
	// aucun reglage de la modale ne peut l'empecher. Restait a choisir qui
	// tranche en cas de debordement — tronquer revenait a laisser le bot
	// decider quelles preuves comptent, en jetant les dernieres de la liste,
	// c'est-a-dire les sensibles. Sur des preuves, ce choix revient au
	// moderateur, meme au prix d'un second passage.
	if (proposes.length > place) {
		const detail =
			dejaPresentes > 0
				? ` (elle en porte déjà ${dejaPresentes} sur ${MAX_MODERATION_ATTACHMENTS})`
				: "";

		await interaction.editReply(
			`${proposes.length} fichiers proposés pour ${place} place(s) restante(s) sur cette sanction${detail}.` +
				"\n\nRien n'a été enregistré : relance `/preuve` en ne joignant que les preuves à conserver," +
				" les deux zones comptant dans le même plafond.",
		);
		return;
	}

	const rejets: Rejet[] = [];

	const telecharges = (
		await Promise.all(
			proposes.map(({ file, spoiler }) => telecharger(file, spoiler, rejets)),
		)
	).filter((preuve) => preuve !== null);

	if (!telecharges.length) {
		await interaction.editReply(
			`Aucune preuve enregistrée.\n${listerRejets(rejets)}`,
		);
		return;
	}

	// La cle etrangere vers `discord_users` exige que le moderateur y figure :
	// un compte du staff jamais croise par le referentiel ferait echouer
	// l'insertion entiere.
	await upsertUser(interaction.user);

	await prisma.moderationAttachment.createMany({
		data: telecharges.map((preuve) => ({
			sanctionId: sanction.id,
			fileName: preuve.fileName,
			contentType: preuve.contentType,
			size: preuve.size,
			data: preuve.data,
			spoiler: preuve.spoiler,
			uploadedByDiscordId: interaction.user.id,
		})),
	});

	const masquees = telecharges.filter((preuve) => preuve.spoiler).length;
	const detail = masquees ? ` (dont ${masquees} masquée(s))` : "";

	await interaction.editReply(
		`${telecharges.length} preuve(s) enregistrée(s)${detail}.` +
			(rejets.length ? `\n\nIgnore :\n${listerRejets(rejets)}` : ""),
	);
}
