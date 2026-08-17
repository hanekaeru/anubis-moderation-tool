import { EmbedBuilder, PermissionFlagsBits, type GuildMember, type Message } from "discord.js";
import {
	AUTOMOD_RULE_TYPE_LABELS,
	AutomodAction,
	AutomodRuleType,
	DEFAULT_SPAM_TIMEOUT_SECONDS,
	LogChannelKey,
	SanctionType,
	type AttachmentSpamSettings,
	type AutomodRuleSettings,
	type ExcessiveCapsSettings,
	type LinksInvitesSettings,
	type MassMentionsSettings,
	type RepetitionSettings,
	type SpamRateSettings,
	type WordFilterSettings,
} from "@anubis/shared";
import { Prisma } from "@anubis/shared/prisma";
import * as colors from "../utils/constantes";
import prisma from "../prisma";
import * as guildConfig from "./guildConfig";
import * as moderation from "./moderation";

/**
 * Automoderation : anti-spam, anti-mentions massives, anti-liens/invitations,
 * filtre de mots, majuscules excessives, repetition.
 *
 * Les regles activees sont mises en cache par serveur (TTL court) pour ne pas
 * requeter la base a chaque message — meme esprit que le cache
 * `ticketChannels`/`contexteConnu` deja utilise ailleurs. Une seule regle se
 * declenche par message : la premiere trouvee dans l'ordre de la base.
 */

const RULES_CACHE_TTL_MS = 30_000;

interface RuleRow {
	id: string;
	type: AutomodRuleType;
	action: AutomodAction;
	timeoutSeconds: number | null;
	settings: AutomodRuleSettings;
	exemptRoleIds: string[];
	/** Sert de cle de cache aux expressions compilees du filtre de mots. */
	updatedAt: Date;
}

const rulesCache = new Map<string, { rules: RuleRow[]; expiresAt: number }>();

async function getEnabledRules(guildId: string): Promise<RuleRow[]> {
	const cached = rulesCache.get(guildId);
	if (cached && cached.expiresAt > Date.now()) return cached.rules;

	const rows = await prisma.automodRule.findMany({ where: { guildId, enabled: true } });

	const rules: RuleRow[] = rows.map((row) => ({
		id: row.id,
		type: row.type,
		action: row.action,
		timeoutSeconds: row.timeoutSeconds,
		settings: row.settings as unknown as AutomodRuleSettings,
		exemptRoleIds: row.exemptRoleIds,
		updatedAt: row.updatedAt,
	}));

	rulesCache.set(guildId, { rules, expiresAt: Date.now() + RULES_CACHE_TTL_MS });
	return rules;
}

// Buffers memoire pour les regles a fenetre glissante / a etat.
/** `${guildId}:${userId}` -> horodatages des derniers messages, pour SPAM_RATE. */
const spamBuffer = new Map<string, number[]>();
/**
 * `${guildId}:${userId}` -> horodatages des dernieres pieces jointes, pour
 * ATTACHMENT_SPAM. Un envoi de dix images pose dix horodatages : le seuil porte
 * sur les fichiers, pas sur les messages.
 */
const attachmentBuffer = new Map<string, number[]>();
/** `${guildId}:${userId}` -> dernier message + nombre de repetitions, pour REPETITION. */
const lastMessageByUser = new Map<string, { content: string; count: number }>();

const INVITE_REGEX = /(discord\.gg|discord(?:app)?\.com\/invite)\/\S+/i;
const URL_REGEX = /https?:\/\/\S+/gi;

function isExempt(member: GuildMember, exemptRoleIds: string[]): boolean {
	if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) return true;
	return exemptRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

interface Trigger {
	rule: RuleRow;
	details: Record<string, unknown>;
}

function checkSpamRate(message: Message<true>, rule: RuleRow): Trigger | null {
	const settings = rule.settings as SpamRateSettings;
	const key = `${message.guild.id}:${message.author.id}`;
	const now = Date.now();
	const windowMs = settings.windowSeconds * 1000;

	const timestamps = (spamBuffer.get(key) ?? []).filter((t) => now - t < windowMs);
	timestamps.push(now);
	spamBuffer.set(key, timestamps);

	if (timestamps.length > settings.messageThreshold) {
		return { rule, details: { count: timestamps.length, windowSeconds: settings.windowSeconds } };
	}
	return null;
}

/**
 * Envoi repete d'images ou de pieces jointes.
 *
 * Distincte de `SPAM_RATE` parce que les deux ne voient pas la meme chose :
 * dix images postees en un seul message ne comptent que pour un message, et
 * passeraient donc sous un seuil de debit. C'est pourtant la forme la plus
 * courante d'inondation d'un salon.
 *
 * Les integrations d'images (`message.embeds` d'un lien direct vers un
 * fichier) comptent aussi : sans elles, coller dix liens d'images echapperait
 * a la regle tout en produisant exactement le meme resultat a l'ecran.
 */
function checkAttachmentSpam(message: Message<true>, rule: RuleRow): Trigger | null {
	const settings = rule.settings as AttachmentSpamSettings;

	const attachments = [...message.attachments.values()].filter((attachment) =>
		settings.imagesOnly ? Boolean(attachment.contentType?.startsWith("image/")) : true,
	);

	const embedImages = message.embeds.filter(
		(embed) => embed.image ?? embed.thumbnail ?? embed.data.type === "image",
	);

	const posted = attachments.length + embedImages.length;
	if (posted === 0) return null;

	const key = `${message.guild.id}:${message.author.id}`;
	const now = Date.now();
	const windowMs = settings.windowSeconds * 1000;

	const timestamps = (attachmentBuffer.get(key) ?? []).filter((t) => now - t < windowMs);
	for (let index = 0; index < posted; index += 1) timestamps.push(now);
	attachmentBuffer.set(key, timestamps);

	if (timestamps.length > settings.attachmentThreshold) {
		return {
			rule,
			details: {
				count: timestamps.length,
				windowSeconds: settings.windowSeconds,
				imagesOnly: settings.imagesOnly,
			},
		};
	}

	return null;
}

function checkMassMentions(message: Message<true>, rule: RuleRow): Trigger | null {
	const settings = rule.settings as MassMentionsSettings;
	const count = message.mentions.users.size + message.mentions.roles.size;
	return count > settings.mentionThreshold ? { rule, details: { mentionCount: count } } : null;
}

function checkLinksInvites(message: Message<true>, rule: RuleRow): Trigger | null {
	const settings = rule.settings as LinksInvitesSettings;
	const content = message.content;

	if (settings.blockInvites && INVITE_REGEX.test(content)) {
		return { rule, details: { matched: "invite" } };
	}

	if (settings.blockLinks) {
		const urls = content.match(URL_REGEX) ?? [];
		const disallowed = urls.filter((url) => {
			try {
				const host = new URL(url).hostname.replace(/^www\./, "");
				return !settings.allowedDomains.some(
					(domain) => host === domain || host.endsWith(`.${domain}`),
				);
			} catch {
				return true;
			}
		});
		if (disallowed.length) return { rule, details: { matched: "link", urls: disallowed } };
	}

	return null;
}

/**
 * Expressions compilees, par regle.
 *
 * Compiler a chaque message coute cher pour rien : le jeu ne change qu'a
 * l'enregistrement de la regle. La cle inclut la date de mise a jour, ce qui
 * fait tomber l'entree d'elle-meme des que le dashboard modifie le filtre —
 * sans quoi le bot garderait l'ancien jeu jusqu'a son redemarrage.
 */
const patternsCache = new Map<string, RegExp[]>();

function compiledPatterns(rule: RuleRow): RegExp[] {
	const settings = rule.settings as WordFilterSettings;
	const cle = `${rule.id}:${rule.updatedAt.getTime()}`;

	const enCache = patternsCache.get(cle);
	if (enCache) return enCache;

	const compilees: RegExp[] = [];
	for (const pattern of settings.patterns ?? []) {
		try {
			compilees.push(new RegExp(pattern, "iu"));
		} catch {
			// L'API refuse deja les expressions invalides : n'en arriver ici
			// signifie qu'une ligne a ete ecrite hors de l'API. On l'ignore
			// plutot que de laisser une regle casser tout le filtre.
			console.warn(`[Automod] Expression ignorée (invalide) : ${pattern}`);
		}
	}

	patternsCache.clear();
	patternsCache.set(cle, compilees);
	return compilees;
}

function checkWordFilter(message: Message<true>, rule: RuleRow): Trigger | null {
	const settings = rule.settings as WordFilterSettings;
	const content = message.content.toLowerCase();

	const matched = settings.words.find((word) => word && content.includes(word.toLowerCase()));
	if (matched) return { rule, details: { matched, via: "mot" } };

	for (const pattern of compiledPatterns(rule)) {
		// `lastIndex` n'a pas a etre remis a zero : les expressions sont
		// compilees sans le drapeau `g`, elles ne conservent pas de position.
		if (pattern.test(message.content)) {
			return { rule, details: { matched: pattern.source, via: "expression" } };
		}
	}

	return null;
}

function checkExcessiveCaps(message: Message<true>, rule: RuleRow): Trigger | null {
	const settings = rule.settings as ExcessiveCapsSettings;
	const letters = message.content.replace(/[^a-zA-ZÀ-ÿ]/g, "");
	if (letters.length < settings.minLength) return null;

	const upper = letters.replace(/[^A-ZÀ-Þ]/g, "");
	const ratio = upper.length / letters.length;
	return ratio > settings.capsRatio ? { rule, details: { ratio: Math.round(ratio * 100) / 100 } } : null;
}

function checkRepetition(message: Message<true>, rule: RuleRow): Trigger | null {
	const settings = rule.settings as RepetitionSettings;
	const content = message.content;

	const repeatedCharMatch = [...content.matchAll(/(.)\1*/g)].find(
		(match) => match[0].length >= settings.maxRepeatedChars,
	);
	if (repeatedCharMatch) return { rule, details: { matched: "chars", run: repeatedCharMatch[0][0] } };

	const key = `${message.guild.id}:${message.author.id}`;
	const previous = lastMessageByUser.get(key);

	if (previous && previous.content === content && content.length > 0) {
		const count = previous.count + 1;
		lastMessageByUser.set(key, { content, count });
		if (count >= settings.maxDuplicateMessages) {
			return { rule, details: { matched: "duplicate", count } };
		}
	} else {
		lastMessageByUser.set(key, { content, count: 1 });
	}

	return null;
}

const CHECKS: Record<AutomodRuleType, (message: Message<true>, rule: RuleRow) => Trigger | null> = {
	SPAM_RATE: checkSpamRate,
	ATTACHMENT_SPAM: checkAttachmentSpam,
	MASS_MENTIONS: checkMassMentions,
	LINKS_INVITES: checkLinksInvites,
	WORD_FILTER: checkWordFilter,
	EXCESSIVE_CAPS: checkExcessiveCaps,
	REPETITION: checkRepetition,
};

async function alertStaff(message: Message<true>, trigger: Trigger): Promise<void> {
	const channelId = await guildConfig.getConfig(message.guild.id, LogChannelKey.MODERATION);
	if (!channelId) return;

	const channel = await message.guild.channels.fetch(channelId).catch(() => null);
	if (!channel?.isTextBased()) return;

	const embed = new EmbedBuilder()
		.setColor(colors.warning)
		.setTitle(`Automod — ${AUTOMOD_RULE_TYPE_LABELS[trigger.rule.type]}`)
		.setDescription(`${message.author} dans ${message.channel} — action : ${trigger.rule.action}`)
		.addFields({ name: "Message", value: message.content.slice(0, 1000) || "(vide ou pièces jointes)" })
		.setTimestamp();

	await channel.send({ embeds: [embed] }).catch(() => undefined);
}

async function handleTrigger(
	message: Message<true>,
	member: GuildMember,
	trigger: Trigger,
): Promise<void> {
	const { rule } = trigger;

	const attachments = [...message.attachments.values()].map((attachment) => ({
		fileName: attachment.name,
		contentType: attachment.contentType ?? "application/octet-stream",
		size: attachment.size,
	}));

	await prisma.automodIncident.create({
		data: {
			guildId: message.guild.id,
			ruleType: rule.type,
			userId: message.author.id,
			channelId: message.channel.id,
			action: rule.action,
			messageContent: message.content || null,
			messageAttachments: attachments.length ? attachments : Prisma.JsonNull,
			details: trigger.details as Prisma.InputJsonValue,
		},
	});

	if (rule.action !== AutomodAction.LOG_ONLY) {
		await message.delete().catch(() => undefined);
	}

	// Les fenetres glissantes sont purgees des le declenchement : sans cela, les
	// horodatages deja au-dessus du seuil y restent et chaque message suivant
	// redeclenche la regle, ouvrant un incident et une sanction de plus a chaque
	// fois pour une seule et meme inondation.
	const bufferKey = `${message.guild.id}:${message.author.id}`;
	spamBuffer.delete(bufferKey);
	attachmentBuffer.delete(bufferKey);

	if (rule.action === AutomodAction.DELETE_AND_TIMEOUT) {
		const durationSeconds = rule.timeoutSeconds ?? DEFAULT_SPAM_TIMEOUT_SECONDS;

		await member.timeout(durationSeconds * 1000, `Automod : ${rule.type}`).catch(() => undefined);

		await moderation.createSanction({
			guildId: message.guild.id,
			userId: message.author.id,
			moderatorId: message.client.user.id,
			type: SanctionType.TIMEOUT,
			reason: `Automod : ${AUTOMOD_RULE_TYPE_LABELS[rule.type]}`,
			durationSeconds,
		});
	}

	await alertStaff(message, trigger);
}

export async function processMessage(message: Message<true>): Promise<void> {
	if (message.author.bot) return;

	const rules = await getEnabledRules(message.guild.id);
	if (!rules.length) return;

	const member =
		message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
	if (!member) return;

	for (const rule of rules) {
		if (isExempt(member, rule.exemptRoleIds)) continue;

		const trigger = CHECKS[rule.type](message, rule);
		if (!trigger) continue;

		await handleTrigger(message, member, trigger);
		return;
	}
}

/** A appeler quand une regle est modifiee depuis la webapp, si on veut une reaction plus rapide que le TTL. */
export function invalidateCache(guildId: string): void {
	rulesCache.delete(guildId);
}
