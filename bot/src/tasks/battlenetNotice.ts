import { EmbedBuilder, type Client, type Guild } from "discord.js";
import { LogChannelKey, QuarantineStage, quarantineStage } from "@anubis/shared";
import * as guildConfig from "../collectors/guildConfig";
import prisma from "../prisma";
import * as colors from "../utils/constantes";

/**
 * Annonce des verifications Battle.net reussies et des deliaisons : journal de
 * moderation, et message prive au membre.
 *
 * L'API ecrit le lien mais n'a aucun acces a Discord — meme patron que
 * `warningNotice`. Le declencheur est la ligne `battlenet_accounts` : un lien
 * actif en attente annonce une verification, une trace en attente annonce une
 * deliaison. La verification ne repart pas quand le statut de quarantaine
 * repasse en attente pour une autre raison (une levee manuelle, par exemple),
 * puisque ce n'est pas lui qui declenche.
 *
 * `discordSyncedAt` est pose **meme quand les envois echouent** (salon
 * supprime, messages prives fermes) : sans cela l'annonce reviendrait toutes
 * les cinq secondes, indefiniment.
 */
export async function checkPendingBattlenetNotices(
	client: Client,
): Promise<void> {
	const pending = await prisma.battlenetAccount.findMany({
		where: { discordSyncedAt: null },
		include: { user: true, unlinkedBy: true },
		orderBy: { verifiedAt: "asc" },
		take: 20,
	});

	for (const lien of pending) {
		const guild = client.guilds.cache.get(lien.guildId);

		// Serveur inconnu du bot : on laisse la ligne en attente plutot que de la
		// marquer annoncee, le bot y sera peut-etre reconnecte plus tard.
		if (!guild) continue;

		try {
			if (lien.unlinkedAt) {
				await annoncerDeliaison(guild, lien);
			} else {
				await annoncer(guild, lien.userId, lien.user.username);
			}
		} catch (err) {
			console.error(
				`[Battle.net] Annonce pour ${lien.userId} échouée :`,
				err,
			);
		}

		await prisma.battlenetAccount.update({
			where: { battlenetHash: lien.battlenetHash },
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
		journaliser(
			guild,
			new EmbedBuilder()
				.setColor(colors.success)
				.setTitle("✅ Compte Battle.net vérifié")
				.setDescription(`<@${userId}> | \`${username}\` | \`${userId}\``)
				.setFooter({
					text: "Le BattleTag n'est consultable que par les administrateurs, depuis le dashboard.",
				})
				.setTimestamp(),
		),
		prevenirLeMembre(guild, userId),
	]);
}

/**
 * Deliaison : trace pour l'equipe, et message au membre quand ce n'est pas
 * lui qui a delie — il apprendrait sinon la perte de son role sans savoir
 * pourquoi. Le membre qui delie lui-meme a deja eu sa reponse sur Discord.
 */
async function annoncerDeliaison(
	guild: Guild,
	lien: {
		userId: string;
		unlinkedByDiscordId: string | null;
		unlinkedBy: { displayName: string } | null;
		user: { username: string };
	},
): Promise<void> {
	const parLuiMeme = lien.unlinkedByDiscordId === lien.userId;
	const auteur = parLuiMeme
		? "par le membre lui-même"
		: lien.unlinkedByDiscordId
			? `par <@${lien.unlinkedByDiscordId}>`
			: lien.unlinkedBy
				? `par ${lien.unlinkedBy.displayName} (dashboard)`
				: "depuis le dashboard";

	const envois: Promise<unknown>[] = [
		journaliser(
			guild,
			new EmbedBuilder()
				.setColor(colors.warning)
				.setTitle("🔗 Compte Battle.net délié")
				.setDescription(
					`<@${lien.userId}> | \`${lien.user.username}\` | \`${lien.userId}\`\n` +
						`Délié ${auteur}. Le compte Blizzard reste bloqué pour les autres membres.`,
				)
				.setTimestamp(),
		),
	];

	if (!parLuiMeme) {
		envois.push(
			(async () => {
				const member = await guild.members.fetch(lien.userId).catch(() => null);
				await member?.send(
					`🔗 L'équipe de **${guild.name}** a délié ton compte Battle.net. ` +
						"Tu peux le relier avec `/lier_battlenet` ; contacte-la si tu ne comprends pas pourquoi.",
				);
			})(),
		);
	}

	await Promise.allSettled(envois);
}

/**
 * Trace pour l'equipe.
 *
 * **Jamais le BattleTag**, volontairement : il est reserve a la permission
 * `battlenet:read` (administrateurs) dans le dashboard, or le salon de logs est
 * lu par toute l'equipe de moderation. Ce qui releve du travail courant, c'est
 * que le membre a franchi l'etape ; son identite Blizzard, non.
 */
async function journaliser(guild: Guild, embed: EmbedBuilder): Promise<void> {
	const channelId = await guildConfig.getConfig(
		guild.id,
		LogChannelKey.MODERATION,
	);
	if (!channelId) return;

	const channel = await guild.channels.fetch(channelId).catch(() => null);
	if (!channel?.isTextBased()) return;

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
			select: { enabled: true, battlenetRequired: true },
		}),
		prisma.quarantineStatus.findUnique({
			where: { guildId_userId: { guildId: guild.id, userId } },
		}),
	]);

	// Verification hors parcours de quarantaine (`/lier_battlenet`, quarantaine
	// coupee) : rien a annoncer sur l'acces, le membre l'a deja.
	const enParcours = Boolean(config?.enabled && config.battlenetRequired && statut);
	const etape = enParcours
		? quarantineStage(statut!, true)
		: QuarantineStage.CLEARED;

	const suite = !enParcours
		? ""
		: etape === QuarantineStage.CLEARED
			? ` Ton accès à **${guild.name}** est maintenant ouvert.`
			: ` Il te reste à accepter le règlement de **${guild.name}** pour ouvrir ton accès.`;

	const member = await guild.members.fetch(userId).catch(() => null);
	if (!member) return;

	await member.send(
		`✅ Ton compte Battle.net est vérifié et lié à ton compte Discord sur **${guild.name}**.${suite}\n` +
			"-# Tu peux le délier à tout moment avec `/delier_battlenet`.",
	);
}
