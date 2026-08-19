import { EmbedBuilder, type Client, type Guild } from "discord.js";
import { ACCOUNT_FLAG_TYPE_LABELS, LogChannelKey } from "@anubis/shared";
import * as guildConfig from "../collectors/guildConfig";
import prisma from "../prisma";
import * as colors from "../utils/constantes";

/**
 * Alertes des signalements que le bot n'a pas poses lui-meme.
 *
 * `accountSurveillance` alerte dans la foulee de l'arrivee et marque
 * `discordSyncedAt` tout de suite — il n'a rien a rattraper. Ce qui passe ici,
 * c'est ce qui vient de l'API, qui n'a aucun acces a Discord : aujourd'hui la
 * seule source est une verification Battle.net refusee pour compte deja lie.
 *
 * La date est posee **meme quand l'envoi echoue** (salon supprime, permissions
 * retirees), sur le meme raisonnement que `warningNotice` : sans cela le
 * signalement reviendrait toutes les cinq secondes, indefiniment.
 */
export async function checkPendingAccountFlagAlerts(
	client: Client,
): Promise<void> {
	const pending = await prisma.accountFlag.findMany({
		where: { discordSyncedAt: null },
		include: { user: true },
		orderBy: { createdAt: "asc" },
		// Une avalanche de signalements ne doit pas monopoliser un passage de la
		// boucle : le reste attend le suivant, cinq secondes plus tard.
		take: 20,
	});

	for (const flag of pending) {
		const guild = client.guilds.cache.get(flag.guildId);

		// Serveur inconnu du bot : rien a envoyer, et la ligne serait reprise a
		// chaque passage. On la laisse en attente — le bot y sera peut-etre
		// reconnecte au prochain demarrage.
		if (!guild) continue;

		try {
			await alerter(guild, flag);
		} catch (err) {
			console.error(
				`[Signalements] Alerte du signalement ${flag.id} échouée :`,
				err,
			);
		}

		await prisma.accountFlag.update({
			where: { id: flag.id },
			data: { discordSyncedAt: new Date() },
		});
	}
}

type FlagAvecUtilisateur = {
	type: string;
	userId: string;
	details: unknown;
	user: { username: string };
};

async function alerter(
	guild: Guild,
	flag: FlagAvecUtilisateur,
): Promise<void> {
	const channelId = await guildConfig.getConfig(
		guild.id,
		LogChannelKey.MODERATION,
	);
	if (!channelId) return;

	const channel = await guild.channels.fetch(channelId).catch(() => null);
	if (!channel?.isTextBased()) return;

	const libelle =
		ACCOUNT_FLAG_TYPE_LABELS[
			flag.type as keyof typeof ACCOUNT_FLAG_TYPE_LABELS
		] ?? flag.type;

	const embed = new EmbedBuilder()
		.setColor(colors.warning)
		.setTitle("👀 Compte à surveiller")
		.setDescription(`<@${flag.userId}> (${flag.user.username}) — ${libelle}`)
		.setTimestamp();

	const details = flag.details;
	if (details && typeof details === "object") {
		const lignes = Object.entries(details as Record<string, unknown>)
			.map(([clef, valeur]) => `${clef} : ${String(valeur)}`)
			.join("\n");

		if (lignes) embed.addFields({ name: "Détails", value: lignes });
	}

	await channel.send({ embeds: [embed] }).catch(() => undefined);
}
