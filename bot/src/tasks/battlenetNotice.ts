import { EmbedBuilder, type Client, type Guild } from "discord.js";
import { LogChannelKey, QuarantineStage, quarantineStage } from "@anubis/shared";
import * as guildConfig from "../collectors/guildConfig";
import prisma from "../prisma";
import * as colors from "../utils/constantes";

/**
 * Annonce d'une verification Battle.net reussie : journal de moderation, et
 * message prive au membre.
 *
 * L'API ecrit le lien mais n'a aucun acces a Discord — meme patron que
 * `warningNotice`. Le declencheur est la ligne `battlenet_accounts`, creee
 * exactement une fois par compte Blizzard : l'annonce ne peut donc pas partir
 * deux fois, y compris quand le statut de quarantaine repasse en attente de
 * synchronisation pour une autre raison (une levee manuelle, par exemple).
 *
 * `discordSyncedAt` est pose **meme quand les deux envois echouent** (salon
 * supprime, messages prives fermes) : sans cela l'annonce reviendrait toutes
 * les cinq secondes, indefiniment.
 */
export async function checkPendingBattlenetNotices(
	client: Client,
): Promise<void> {
	const pending = await prisma.battlenetAccount.findMany({
		where: { discordSyncedAt: null },
		include: { user: true },
		orderBy: { verifiedAt: "asc" },
		take: 20,
	});

	for (const lien of pending) {
		const guild = client.guilds.cache.get(lien.guildId);

		// Serveur inconnu du bot : on laisse la ligne en attente plutot que de la
		// marquer annoncee, le bot y sera peut-etre reconnecte plus tard.
		if (!guild) continue;

		try {
			await annoncer(guild, lien.userId, lien.user.username);
		} catch (err) {
			console.error(
				`[Quarantaine] Annonce de vérification de ${lien.userId} échouée :`,
				err,
			);
		}

		await prisma.battlenetAccount.update({
			where: { battlenetId: lien.battlenetId },
			data: { discordSyncedAt: new Date() },
		});
	}
}

async function annoncer(
	guild: Guild,
	userId: string,
	username: string,
): Promise<void> {
	// Les deux envois sont independants : des messages prives fermes ne doivent
	// pas priver le staff de sa trace, et un salon de logs mal configure ne doit
	// pas priver le membre de sa confirmation.
	await Promise.allSettled([
		journaliser(guild, userId, username),
		prevenirLeMembre(guild, userId),
	]);
}

/**
 * Trace pour l'equipe.
 *
 * **Sans le BattleTag**, volontairement : il est reserve a la permission
 * `battlenet:read` (administrateurs) dans le dashboard, or le salon de logs est
 * lu par toute l'equipe de moderation. Ce qui releve du travail courant, c'est
 * que le membre a franchi l'etape ; son identite Blizzard, non.
 */
async function journaliser(
	guild: Guild,
	userId: string,
	username: string,
): Promise<void> {
	const channelId = await guildConfig.getConfig(
		guild.id,
		LogChannelKey.MODERATION,
	);
	if (!channelId) return;

	const channel = await guild.channels.fetch(channelId).catch(() => null);
	if (!channel?.isTextBased()) return;

	const embed = new EmbedBuilder()
		.setColor(colors.success)
		.setTitle("Anubis - :white_check_mark: Compte Battle.net vérifié")
		.setDescription(`<@${userId}> | \`${username}\` | \`${userId}\``)
		.setFooter({
			text: "Le BattleTag lié n'est pas consultable depuis le dashboard pour des raisons de sécurité.",
		})
		.setTimestamp();

	await channel.send({ embeds: [embed] });
}

/**
 * Confirmation au membre.
 *
 * Il revient de Blizzard sur une page web ; sans ce message, rien ne bouge de
 * son cote sur Discord et il ne sait pas si l'etape a compte. Le texte depend
 * de ce qui reste a faire : annoncer un acces ouvert alors que le reglement
 * n'est pas accepte l'enverrait chercher des salons qu'il ne voit pas.
 */
async function prevenirLeMembre(guild: Guild, userId: string): Promise<void> {
	const [config, statut] = await Promise.all([
		prisma.quarantineConfig.findUnique({
			where: { guildId: guild.id },
			select: { battlenetRequired: true },
		}),
		prisma.quarantineStatus.findUnique({
			where: { guildId_userId: { guildId: guild.id, userId } },
		}),
	]);

	// Verification hors parcours de quarantaine : rien a promettre sur l'acces.
	const etape = statut
		? quarantineStage(statut, config?.battlenetRequired ?? false)
		: QuarantineStage.CLEARED;

	const suite =
		etape === QuarantineStage.CLEARED
			? `Ton accès à **${guild.name}** est maintenant ouvert.`
			: `Il te reste à accepter le règlement de **${guild.name}** pour ouvrir ton accès.`;

	const member = await guild.members.fetch(userId).catch(() => null);
	if (!member) return;

	await member.send(`✅ Ton compte Battle.net est vérifié. ${suite}`);
}
