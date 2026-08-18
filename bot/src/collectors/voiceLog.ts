import {
	EmbedBuilder,
	type ColorResolvable,
	type Guild,
	type User,
	type VoiceBasedChannel,
} from "discord.js";
import { LogChannelKey } from "@anubis/shared";
import type { TemporaryVoiceChannel, VoiceHub } from "@anubis/shared/prisma";
import * as colors from "../utils/constantes";
import prisma from "../prisma";
import * as guildConfig from "./guildConfig";

/**
 * Journal des salons vocaux temporaires (`🔊-logs-vocaux`).
 *
 * Le perimetre est celui de la fonctionnalite : les salons crees par le bot et
 * ce qui s'y passe. Les mouvements dans les vocaux ordinaires n'y figurent pas
 * — ils rempliraient le salon sans rien apprendre sur le systeme de parties, et
 * restent de toute facon consultables sur la fiche de chaque membre.
 */

async function envoyer(guild: Guild, embed: EmbedBuilder): Promise<void> {
	const channelId = await guildConfig.getConfig(guild.id, LogChannelKey.VOICE);
	if (!channelId) return;

	const channel = await guild.channels.fetch(channelId).catch(() => null);
	if (!channel?.isTextBased()) return;

	await channel.send({ embeds: [embed] }).catch(() => undefined);
}

function base(titre: string, couleur: ColorResolvable): EmbedBuilder {
	return new EmbedBuilder().setColor(couleur).setTitle(titre).setTimestamp();
}

/** Mention lisible meme si le compte a disparu du cache. */
function membre(userId: string): string {
	return `<@${userId}> | \`${userId}\``;
}

export async function salonCree(
	guild: Guild,
	salon: VoiceBasedChannel,
	proprietaire: User,
	hub: VoiceHub,
): Promise<void> {
	await envoyer(
		guild,
		base("🔊 Salon temporaire créé", colors.success).addFields(
			{ name: "Salon", value: `${salon} | \`${salon.id}\`` },
			{ name: "Salon de création", value: hub.name, inline: true },
			{ name: "Propriétaire", value: membre(proprietaire.id), inline: true },
		),
	);
}

export async function salonSupprime(
	guild: Guild,
	temporaire: TemporaryVoiceChannel,
	raison: string,
): Promise<void> {
	const dureeSecondes = Math.round(
		(Date.now() - temporaire.createdAt.getTime()) / 1000,
	);

	await envoyer(
		guild,
		base("🔇 Salon temporaire supprimé", colors.danger).addFields(
			{ name: "Salon", value: `${temporaire.name} | \`${temporaire.channelId}\`` },
			{ name: "Motif", value: raison, inline: true },
			{
				name: "Durée de vie",
				value: `${Math.floor(dureeSecondes / 60)} min ${dureeSecondes % 60} s`,
				inline: true,
			},
		),
	);
}

export async function membreArrive(
	guild: Guild,
	salon: VoiceBasedChannel,
	userId: string,
): Promise<void> {
	await envoyer(
		guild,
		base("➡️ Arrivée dans un salon temporaire", colors.info).addFields(
			{ name: "Salon", value: `${salon}`, inline: true },
			{ name: "Membre", value: membre(userId), inline: true },
		),
	);
}

export async function membreParti(
	guild: Guild,
	channelId: string,
	nomSalon: string,
	userId: string,
): Promise<void> {
	await envoyer(
		guild,
		base("⬅️ Départ d'un salon temporaire", colors.info).addFields(
			{ name: "Salon", value: `${nomSalon} | \`${channelId}\``, inline: true },
			{ name: "Membre", value: membre(userId), inline: true },
		),
	);
}

export async function proprieteTransferee(
	guild: Guild,
	salon: VoiceBasedChannel,
	ancienId: string,
	nouveauId: string,
): Promise<void> {
	await envoyer(
		guild,
		base("👑 Propriétaire changé", colors.warning).addFields(
			{ name: "Salon", value: `${salon}` },
			{ name: "Ancien", value: membre(ancienId), inline: true },
			{ name: "Nouveau", value: membre(nouveauId), inline: true },
		),
	);
}

export async function verrouChange(
	guild: Guild,
	salon: VoiceBasedChannel,
	auteurId: string,
	verrouille: boolean,
): Promise<void> {
	await envoyer(
		guild,
		base(
			verrouille ? "🔒 Salon verrouillé" : "🔓 Salon déverrouillé",
			colors.warning,
		).addFields(
			{ name: "Salon", value: `${salon}`, inline: true },
			{ name: "Par", value: membre(auteurId), inline: true },
		),
	);
}

export async function membreExpulse(
	guild: Guild,
	salon: VoiceBasedChannel,
	auteurId: string,
	cibleId: string,
): Promise<void> {
	await envoyer(
		guild,
		base("👢 Membre expulsé d'un salon", colors.danger).addFields(
			{ name: "Salon", value: `${salon}` },
			{ name: "Expulsé", value: membre(cibleId), inline: true },
			{ name: "Par", value: membre(auteurId), inline: true },
		),
	);
}

/**
 * Personnalisation d'un salon depuis son panneau.
 *
 * Remplace l'ancienne entree de renommage : le nom d'un salon temporaire ne
 * bouge plus, c'est son sujet qui porte le rang, la plateforme et ce que
 * cherche son proprietaire.
 */
export async function salonPersonnalise(
	guild: Guild,
	salon: VoiceBasedChannel,
	auteurId: string,
	choix: {
		rank: { label: string } | null;
		platform: { label: string } | null;
		sujet: string;
		avertissement: string | null;
	},
): Promise<void> {
	const embed = base("✏️ Salon personnalisé", colors.info).addFields(
		{ name: "Salon", value: `${salon} | \`${salon.id}\`` },
		{ name: "Rang", value: choix.rank?.label ?? "—", inline: true },
		{ name: "Plateforme", value: choix.platform?.label ?? "—", inline: true },
		{ name: "Par", value: membre(auteurId), inline: true },
	);

	if (choix.sujet) {
		embed.addFields({ name: "Sujet", value: choix.sujet.slice(0, 1024) });
	}

	// Un rangement refuse merite d'etre visible du staff : c'est le signe
	// d'une categorie pleine ou d'un identifiant devenu faux dans le
	// dashboard, et le proprietaire n'a aucun moyen d'y remedier lui-meme.
	if (choix.avertissement) {
		embed.setColor(colors.warning).addFields({
			name: "Rangement non appliqué",
			value: choix.avertissement.slice(0, 1024),
		});
	}

	await envoyer(guild, embed);
}

/**
 * Signalement depuis le panneau du salon.
 *
 * Volontairement en `danger` et sans mise en forme decorative : c'est le seul
 * message de ce journal qui appelle une action humaine.
 */
export async function problemeSignale(
	guild: Guild,
	salon: VoiceBasedChannel,
	auteurId: string,
	description: string,
): Promise<void> {
	const occupants = await prisma.voiceSession.findMany({
		where: { guildId: guild.id, channelId: salon.id, leftAt: null },
		select: { userId: true },
	});

	await envoyer(
		guild,
		base("🚩 Problème signalé dans un salon vocal", colors.danger)
			.setDescription(description.slice(0, 2000))
			.addFields(
				{ name: "Salon", value: `${salon} | \`${salon.id}\`` },
				{ name: "Signalé par", value: membre(auteurId), inline: true },
				{
					name: "Présents",
					value:
						occupants.map((occupant) => `<@${occupant.userId}>`).join(", ") ||
						"(aucun)",
				},
			),
	);
}
