import {
	EmbedBuilder,
	TimestampStyles,
	escapeMarkdown,
	time,
	type GuildBan,
	type GuildMember,
	type User,
} from "discord.js";
import {
	ACCOUNT_FLAG_TYPE_LABELS,
	MEMBER_STATUS_LABELS,
	QuarantineStage,
	SANCTION_TYPE_LABELS,
} from "@anubis/shared";
import type { DossierWhois } from "../collectors/whois";
import * as colors from "./constantes";

/** Limite Discord d'une valeur de champ d'embed. */
export const MAX_CHAMP = 1024;

/**
 * Joint des elements sans depasser `max` caracteres, en remplacant ce qui ne
 * tient pas par « … et N autres ». Un champ trop long fait refuser l'embed
 * entier par Discord : un membre aux quarante roles ne doit pas casser
 * `/whois`.
 */
export function joindreDansLaLimite(
	elements: string[],
	separateur = " ",
	max = MAX_CHAMP,
): string {
	if (!elements.length) return "";

	const suite = (reste: number) => ` … et ${reste} autre${reste > 1 ? "s" : ""}`;
	let resultat = "";

	for (let i = 0; i < elements.length; i += 1) {
		const element = elements[i] as string;
		const candidat = resultat ? `${resultat}${separateur}${element}` : element;
		const reste = elements.length - i - 1;
		// On reserve la place de la mention de suite tant qu'il reste des elements.
		const reserve = reste > 0 ? suite(reste).length : 0;
		if (candidat.length + reserve > max) {
			const omis = elements.length - i;
			return resultat ? `${resultat}${suite(omis)}` : suite(omis).trim();
		}
		resultat = candidat;
	}

	return resultat;
}

const QUARANTINE_STAGE_LABELS: Record<QuarantineStage, string> = {
	PENDING: "En quarantaine — rien de validé",
	ACCEPTED_ONLY: "En quarantaine — règlement accepté, Battle.net attendu",
	VERIFIED_ONLY: "En quarantaine — Battle.net vérifié, règlement attendu",
	CLEARED: "Libéré(e)",
};

const IDENTITY_LABELS: Record<DossierWhois["identite"][number]["type"], string> = {
	USERNAME_CHANGED: "Pseudo",
	GLOBAL_NAME_CHANGED: "Nom affiché",
	NICKNAME_CHANGED: "Surnom",
	AVATAR_CHANGED: "Avatar",
};

function date(d: Date | null | undefined): string {
	if (!d) return "—";
	return `${time(d, TimestampStyles.LongDate)} (${time(d, TimestampStyles.RelativeTime)})`;
}

function texte(valeur: string | null | undefined): string {
	return valeur ? escapeMarkdown(valeur) : "—";
}

/** Renseignements tenus par Discord. Le membre est absent s'il a quitte le serveur. */
export function embedDiscord(
	user: User,
	member: GuildMember | null,
	ban: GuildBan | null,
): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(colors.info)
		.setTitle(`Qui est ${escapeMarkdown(user.username)} ?`)
		.setThumbnail((member ?? user).displayAvatarURL({ size: 256 }))
		.addFields(
			{ name: "Identifiant", value: `\`${user.id}\` · <@${user.id}>`, inline: false },
			{ name: "Nom d'utilisateur", value: texte(user.username), inline: true },
			{ name: "Nom affiché", value: texte(user.globalName), inline: true },
			{ name: "Surnom", value: texte(member?.nickname), inline: true },
			{ name: "Compte créé", value: date(user.createdAt), inline: true },
		);

	if (user.bot) embed.setDescription("🤖 Compte de bot");

	if (!member) {
		embed.addFields({
			name: "Sur le serveur",
			value: ban
				? `Non — **banni(e)**${ban.reason ? ` : ${escapeMarkdown(ban.reason).slice(0, 900)}` : ""}`
				: "Non",
			inline: false,
		});
		return embed;
	}

	embed.addFields({ name: "Arrivée", value: date(member.joinedAt), inline: true });

	if (member.premiumSince) {
		embed.addFields({ name: "Boost", value: `Depuis ${date(member.premiumSince)}`, inline: true });
	}

	const timeout = member.communicationDisabledUntil;
	if (timeout && timeout.getTime() > Date.now()) {
		embed.addFields({
			name: "Exclusion temporaire",
			value: `Jusqu'au ${time(timeout, TimestampStyles.LongDateTime)} (${time(timeout, TimestampStyles.RelativeTime)})`,
			inline: false,
		});
	}

	// Du plus haut au plus bas, comme dans le client ; sans @everyone, que
	// tout le monde porte.
	const roles = [...member.roles.cache.values()]
		.filter((role) => role.id !== member.guild.id)
		.sort((a, b) => b.position - a.position)
		.map((role) => `<@&${role.id}>`);
	embed.addFields({
		name: `Rôles (${roles.length})`,
		value: joindreDansLaLimite(roles) || "Aucun",
		inline: false,
	});

	return embed;
}

/** Ce que la base d'Anubis a retenu du compte, present ou parti. */
export function embedBase(dossier: DossierWhois): EmbedBuilder {
	const embed = new EmbedBuilder().setColor(colors.danger).setTitle(":eyes: Connu par Anubis");

	if (!dossier.connu) {
		return embed.setDescription("Ce compte n'a jamais été vu par le bot sur ce serveur.");
	}

	const { member } = dossier;
	if (member) {
		const presence = [
			`**${MEMBER_STATUS_LABELS[member.status]}**`,
			member.joinedAt ? `arrivée ${date(member.joinedAt)}` : null,
			member.leftAt && member.status !== "ACTIVE" ? `départ ${date(member.leftAt)}` : null,
			member.joinCount > 1 ? `${member.joinCount} arrivées` : null,
		].filter(Boolean);
		embed.addFields({ name: "Présence", value: presence.join("\n"), inline: false });
	}

	if (dossier.identite.length) {
		const lignes = dossier.identite.map(
			(e) =>
				`${time(e.occurredAt, TimestampStyles.ShortDate)} · ${IDENTITY_LABELS[e.type]} : ${texte(e.oldValue)} → ${texte(e.newValue)}`,
		);
		embed.addFields({
			name: "Historique des noms",
			value: joindreDansLaLimite(lignes, "\n"),
			inline: false,
		});
	}

	embed.addFields(
		{
			name: "Expérience",
			value: `Niveau **${dossier.xp.level}** · ${dossier.xp.xp.toLocaleString("fr-FR")} XP · rang #${dossier.xp.rank}`,
			inline: false,
		},
		{
			name: "Messages",
			value: [
				`${dossier.messages.total.toLocaleString("fr-FR")} au total`,
				`${dossier.messages.recents.toLocaleString("fr-FR")} sur 30 jours`,
				dossier.messages.dernierJour
					? `dernier jour actif : ${time(dossier.messages.dernierJour, TimestampStyles.ShortDate)}`
					: null,
			]
				.filter(Boolean)
				.join("\n"),
			inline: true,
		},
	);

	const { moderation } = dossier;
	const sanctions = moderation.sanctionsActives.map((s) => {
		const fin = s.expiresAt ? ` jusqu'au ${time(s.expiresAt, TimestampStyles.ShortDateTime)}` : " (permanente)";
		return `• ${SANCTION_TYPE_LABELS[s.type]}${fin} — ${escapeMarkdown(s.reason).slice(0, 120)}`;
	});
	const autres = moderation.sanctionsActivesTotal - moderation.sanctionsActives.length;
	if (autres > 0) sanctions.push(`… et ${autres} autre${autres > 1 ? "s" : ""}`);
	embed.addFields({
		name: "Modération",
		value: joindreDansLaLimite(
			[
				`Avertissements actifs : **${moderation.avertissementsActifs}** (sur ${moderation.avertissementsTotal})`,
				`Sanctions actives : **${moderation.sanctionsActivesTotal}** (sur ${moderation.sanctionsTotal})`,
				...sanctions,
			],
			"\n",
		),
		inline: true,
	});

	embed.addFields(
		{
			name: "Quarantaine",
			value: dossier.quarantaine
				? `${QUARANTINE_STAGE_LABELS[dossier.quarantaine.stage]}\nentrée ${date(dossier.quarantaine.quarantinedAt)}`
				: "Jamais mis(e) en quarantaine",
			inline: false,
		},
		{
			name: "Battle.net",
			value: dossier.battlenetVerifieLe
				? `✅ Vérifié le ${time(dossier.battlenetVerifieLe, TimestampStyles.LongDate)}`
				: "Non vérifié",
			inline: true,
		},
	);

	const { signalements } = dossier;
	embed.addFields({
		name: `Signalements (${signalements.total})`,
		value: signalements.total
			? joindreDansLaLimite(
				signalements.derniers.map(
					(s) =>
						`• ${ACCOUNT_FLAG_TYPE_LABELS[s.type]} — ${time(s.createdAt, TimestampStyles.ShortDate)}${s.reviewed ? " (examiné)" : ""}`,
				),
				"\n",
			)
			: "Aucun",
		inline: true,
	});

	return embed;
}
