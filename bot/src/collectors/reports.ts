import { randomUUID } from "node:crypto";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	TimestampStyles,
	escapeMarkdown,
	time,
	type Guild,
	type GuildMember,
	type Message,
	type User,
} from "discord.js";
import { LogChannelKey } from "@anubis/shared";
import * as colors from "../utils/constantes";
import { joindreDansLaLimite } from "../utils/whoisEmbeds";
import * as guildConfig from "./guildConfig";
import { roleDAlerte } from "../utils/mentions";

/**
 * Signalement d'un message par un membre (clic droit > Applications >
 * « Signaler au staff »).
 *
 * Le message est **capture des le clic**, avant la modale du motif : c'est le
 * moment ou il existe a coup sur. L'auteur peut le supprimer pendant que le
 * membre ecrit son motif, et le signalement doit quand meme dire ce qui etait
 * ecrit. La capture vit en memoire le temps de la modale (`DUREE_CAPTURE`),
 * jamais en base : comme les apercus de liens, le contenu ne fait que passer
 * du salon d'origine au salon des signalements.
 */

/** Une modale laissee ouverte plus longtemps est simplement perdue. */
const DUREE_CAPTURE = 15 * 60_000;
/** Au-dela, un meme message peut de nouveau etre signale par la meme personne. */
const MEMOIRE_DES_SIGNALEMENTS = 24 * 3600_000;
/** Delai entre deux signalements d'une meme personne. */
export const DELAI_ENTRE_SIGNALEMENTS = 30_000;

export const REPORT_MODAL_PREFIX = "signalement:modale:";
export const REPORT_REASON_INPUT = "signalement:motif";
export const REPORT_WHOIS_PREFIX = "signalement:fiche:";

export interface Capture {
	guildId: string;
	channelId: string;
	messageId: string;
	url: string;
	content: string;
	createdAt: Date;
	authorId: string;
	/** Message d'un webhook : pas de fiche a ouvrir, l'identifiant n'est pas un compte. */
	webhook: boolean;
	attachments: { name: string; url: string; image: boolean; spoiler: boolean }[];
	reporterId: string;
}

const captures = new Map<string, Capture>();
/** `reporterId:messageId` deja signales : un seul signalement par message et par personne. */
const dejaSignales = new Map<string, number>();
const derniersSignalements = new Map<string, number>();

export type Refus = "propre-message" | "message-du-bot" | "deja-signale" | "trop-tot";

/**
 * Peut-on signaler ce message ? Fonction pure sur l'etat en memoire, pour
 * que la regle se teste sans Discord.
 */
export function refusDeSignalement(
	reporterId: string,
	message: { id: string; authorId: string; authorIsSelf: boolean },
	maintenant: number,
): Refus | null {
	if (message.authorId === reporterId) return "propre-message";
	if (message.authorIsSelf) return "message-du-bot";
	const signaleLe = dejaSignales.get(`${reporterId}:${message.id}`);
	if (signaleLe !== undefined && maintenant - signaleLe <= MEMOIRE_DES_SIGNALEMENTS) return "deja-signale";
	const precedent = derniersSignalements.get(reporterId);
	if (precedent !== undefined && maintenant - precedent < DELAI_ENTRE_SIGNALEMENTS) return "trop-tot";
	return null;
}

/**
 * La modale du motif. Ici et non dans la commande, pour que les tests la
 * construisent : Discord plafonne un libelle de champ a **45 caracteres**, et
 * le builder ne le verifie qu'a l'execution — un libelle trop long ne cassait
 * qu'au premier clic, en production.
 */
export function modaleDeSignalement(cle: string): ModalBuilder {
	const motif = new TextInputBuilder()
		.setCustomId(REPORT_REASON_INPUT)
		.setLabel("Pourquoi ce message pose problème ?")
		.setPlaceholder("Facultatif : insulte, spam, contenu choquant…")
		.setStyle(TextInputStyle.Paragraph)
		.setMaxLength(1000)
		.setRequired(false);

	return new ModalBuilder()
		.setCustomId(`${REPORT_MODAL_PREFIX}${cle}`)
		.setTitle("Signaler au staff")
		.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(motif));
}

/** Garde le message tel qu'il est au clic, et renvoie la cle de la modale. */
export function capturer(message: Message<true>, reporterId: string): string {
	const cle = randomUUID();
	captures.set(cle, {
		guildId: message.guildId,
		channelId: message.channelId,
		messageId: message.id,
		url: message.url,
		content: message.content,
		createdAt: message.createdAt,
		authorId: message.author.id,
		webhook: message.webhookId !== null,
		attachments: [...message.attachments.values()].map((a) => ({
			name: a.name,
			url: a.url,
			image: a.contentType?.startsWith("image/") ?? false,
			spoiler: a.spoiler,
		})),
		reporterId,
	});
	// La duree de vie se compte depuis le clic, pas depuis la date du message.
	setTimeout(() => captures.delete(cle), DUREE_CAPTURE).unref?.();
	return cle;
}

/** Retire la capture : elle ne sert qu'une fois. */
export function reprendre(cle: string): Capture | null {
	const capture = captures.get(cle) ?? null;
	captures.delete(cle);
	return capture;
}

export function marquerSignale(capture: Capture, maintenant = Date.now()): void {
	// Le menage se fait ici, au rythme des signalements : la table ne grossit
	// qu'avec eux.
	for (const [cle, quand] of dejaSignales) {
		if (maintenant - quand > MEMOIRE_DES_SIGNALEMENTS) dejaSignales.delete(cle);
	}
	dejaSignales.set(`${capture.reporterId}:${capture.messageId}`, maintenant);
	derniersSignalements.set(capture.reporterId, maintenant);
}

/** Pour les tests. */
export function oublierTout(): void {
	captures.clear();
	dejaSignales.clear();
	derniersSignalements.clear();
}

function tronquer(texte: string, max: number): string {
	return texte.length <= max ? texte : `${texte.slice(0, max - 1)}…`;
}

/** Les renseignements generaux d'un compte, en quelques lignes. */
export function presenter(user: User | null, userId: string, member: GuildMember | null): string {
	const lignes = [
		`<@${userId}> · \`${userId}\``,
		user ? `Nom : ${escapeMarkdown(user.username)}${user.globalName ? ` (${escapeMarkdown(user.globalName)})` : ""}` : null,
		user ? `Compte créé ${time(user.createdAt, TimestampStyles.RelativeTime)}` : null,
		member?.joinedAt
			? `Arrivé(e) ${time(member.joinedAt, TimestampStyles.RelativeTime)}`
			: "N'est plus sur le serveur",
		member ? `Rôles : ${member.roles.cache.size - 1}` : null,
	];
	return lignes.filter(Boolean).join("\n");
}

/**
 * Publie le signalement dans le salon dedie. Renvoie `false` si le salon n'est
 * pas configure ou introuvable : l'appelant le dit au membre, plutot que de
 * lui laisser croire que le staff a ete prevenu.
 */
export async function publier(guild: Guild, capture: Capture, motif: string | null): Promise<boolean> {
	const channelId = await guildConfig.getConfig(guild.id, LogChannelKey.REPORTS);
	const salon = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
	if (!salon?.isTextBased()) return false;

	const [auteur, auteurMembre, signaleur, signaleurMembre] = await Promise.all([
		capture.webhook ? null : guild.client.users.fetch(capture.authorId).catch(() => null),
		capture.webhook ? null : guild.members.fetch(capture.authorId).catch(() => null),
		guild.client.users.fetch(capture.reporterId).catch(() => null),
		guild.members.fetch(capture.reporterId).catch(() => null),
	]);

	const embed = new EmbedBuilder()
		.setColor(colors.danger)
		.setTitle("🚩 Message signalé")
		.setDescription(capture.content ? tronquer(capture.content, 4000) : "*Message sans texte*")
		.addFields({
			name: "Salon",
			value: `<#${capture.channelId}> · envoyé ${time(capture.createdAt, TimestampStyles.LongDateTime)}`,
		});

	if (motif) embed.addFields({ name: "Motif du signalement", value: tronquer(motif, 1024) });

	if (capture.attachments.length) {
		embed.addFields({
			name: `Pièces jointes (${capture.attachments.length})`,
			value: joindreDansLaLimite(
				capture.attachments.map((a) => `[${escapeMarkdown(a.name)}](${a.url})${a.spoiler ? " (spoiler)" : ""}`),
				"\n",
			),
		});
		// Une image sous spoiler n'est pas affichee en grand : le staff l'ouvre
		// s'il le veut, comme dans le salon d'origine.
		const image = capture.attachments.find((a) => a.image && !a.spoiler);
		if (image) embed.setImage(image.url);
	}

	embed.addFields(
		{
			name: "Auteur",
			value: capture.webhook
				? `Webhook \`${capture.authorId}\``
				: presenter(auteur, capture.authorId, auteurMembre),
			inline: true,
		},
		{ name: "Signalé par", value: presenter(signaleur, capture.reporterId, signaleurMembre), inline: true },
	);
	embed.setTimestamp();

	const boutons = new ActionRowBuilder<ButtonBuilder>();
	if (!capture.webhook) {
		boutons.addComponents(
			new ButtonBuilder()
				.setCustomId(`${REPORT_WHOIS_PREFIX}${capture.authorId}`)
				.setStyle(ButtonStyle.Primary)
				.setLabel("Fiche de l'auteur"),
		);
	}
	boutons.addComponents(
		new ButtonBuilder()
			.setCustomId(`${REPORT_WHOIS_PREFIX}${capture.reporterId}`)
			.setStyle(ButtonStyle.Secondary)
			.setLabel("Fiche du signaleur"),
		new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(capture.url).setLabel("Aller au message"),
	);

	// Meme regle que les tickets et les signalements vocaux : la mention vit
	// dans le contenu (une mention dans un embed ne notifie personne), et seul
	// le role d'alerte peut sonner.
	const role = await roleDAlerte(guild.id);
	await salon.send({
		content: role ? `<@&${role}>` : undefined,
		embeds: [embed],
		components: [boutons],
		allowedMentions: { parse: [], roles: role ? [role] : [] },
	});
	return true;
}
