import { EmbedBuilder, PermissionFlagsBits, type GuildMember } from "discord.js";
import { ACCOUNT_FLAG_TYPE_LABELS, AccountFlagType, LogChannelKey, SanctionType } from "@anubis/shared";
import { Prisma } from "@anubis/shared/prisma";
import * as colors from "../../utils/constantes";
import prisma from "../prisma";
import * as guildConfig from "./guildConfig";

/**
 * Surveillance de comptes suspects a l'arrivee : compte recent, avatar par
 * defaut, pseudo imitant un membre du staff, retour rapide apres un depart,
 * arrivee juste apres un bannissement recent sur le serveur.
 *
 * Jamais de sanction automatique — uniquement une trace (`AccountFlag`) et
 * une alerte consolidee au staff, qui reste seul juge.
 */

const NEW_ACCOUNT_MS = 2 * 24 * 60 * 60 * 1000;
const QUICK_REJOIN_MS = 24 * 60 * 60 * 1000;
const RECENT_BAN_WINDOW_MS = 15 * 60 * 1000;
/** Distance de Levenshtein maximale entre deux pseudos normalises pour les considerer "similaires". */
const NAME_SIMILARITY_MAX_DISTANCE = 2;

function normalize(name: string): string {
	return name
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.trim();
}

/** Distance d'edition simple, suffisante pour reperer un pseudo "presque identique". */
function levenshtein(a: string, b: string): number {
	const rows = a.length + 1;
	const cols = b.length + 1;
	const matrix: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

	for (let i = 0; i < rows; i++) matrix[i]![0] = i;
	for (let j = 0; j < cols; j++) matrix[0]![j] = j;

	for (let i = 1; i < rows; i++) {
		for (let j = 1; j < cols; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i]![j] = Math.min(
				matrix[i - 1]![j]! + 1,
				matrix[i]![j - 1]! + 1,
				matrix[i - 1]![j - 1]! + cost,
			);
		}
	}

	return matrix[rows - 1]![cols - 1]!;
}

async function findImpersonatedStaffName(member: GuildMember): Promise<string | null> {
	const candidates = [member.user.username, member.user.globalName, member.nickname]
		.filter((value): value is string => Boolean(value))
		.map(normalize);

	const staffMembers = member.guild.members.cache.filter(
		(m) => m.id !== member.id && m.permissions.has(PermissionFlagsBits.ModerateMembers),
	);

	for (const staff of staffMembers.values()) {
		const staffNames = [staff.user.username, staff.user.globalName, staff.nickname]
			.filter((value): value is string => Boolean(value))
			.map(normalize);

		for (const candidate of candidates) {
			if (candidate.length < 3) continue;

			for (const staffName of staffNames) {
				if (staffName.length < 3) continue;
				if (
					candidate === staffName ||
					levenshtein(candidate, staffName) <= NAME_SIMILARITY_MAX_DISTANCE
				) {
					return staff.user.tag;
				}
			}
		}
	}

	return null;
}

interface FlagResult {
	type: AccountFlagType;
	details: Record<string, unknown>;
}

async function alertStaff(member: GuildMember, flags: FlagResult[]): Promise<void> {
	const channelId = await guildConfig.getConfig(member.guild.id, LogChannelKey.MODERATION);
	if (!channelId) return;

	const channel = await member.guild.channels.fetch(channelId).catch(() => null);
	if (!channel?.isTextBased()) return;

	const embed = new EmbedBuilder()
		.setColor(colors.warning)
		.setTitle("👀 Compte a surveiller")
		.setDescription(
			`${member} vient d'arriver — aucune action automatique, a verifier par le staff.`,
		)
		.addFields(
			flags.map((flag) => ({
				name: ACCOUNT_FLAG_TYPE_LABELS[flag.type],
				value:
					Object.entries(flag.details)
						.map(([key, value]) => `${key} : ${value}`)
						.join(", ") || "—",
			})),
		)
		.setTimestamp();

	await channel.send({ embeds: [embed] }).catch(() => undefined);
}

/**
 * A appeler depuis `guildMemberAdd.ts`, avant l'upsert qui ecraserait
 * `Member.leftAt` — necessaire pour detecter un retour rapide.
 */
export async function evaluateNewMember(member: GuildMember): Promise<void> {
	const now = Date.now();
	const flags: FlagResult[] = [];

	const accountAgeMs = now - member.user.createdTimestamp;
	if (accountAgeMs < NEW_ACCOUNT_MS) {
		flags.push({
			type: AccountFlagType.NEW_ACCOUNT,
			details: { accountAgeHours: Math.round(accountAgeMs / 3_600_000) },
		});
	}

	if (!member.user.avatar) {
		flags.push({ type: AccountFlagType.DEFAULT_AVATAR, details: {} });
	}

	const impersonated = await findImpersonatedStaffName(member);
	if (impersonated) {
		flags.push({
			type: AccountFlagType.STAFF_IMPERSONATION,
			details: { staffMember: impersonated },
		});
	}

	const previousMembership = await prisma.member.findUnique({
		where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
		select: { leftAt: true },
	});

	if (previousMembership?.leftAt) {
		const awayMs = now - previousMembership.leftAt.getTime();
		if (awayMs < QUICK_REJOIN_MS) {
			flags.push({
				type: AccountFlagType.QUICK_REJOIN,
				details: { awayMinutes: Math.round(awayMs / 60_000) },
			});
		}
	}

	const recentBan = await prisma.sanction.findFirst({
		where: {
			guildId: member.guild.id,
			type: { in: [SanctionType.BAN, SanctionType.KICK] },
			createdAt: { gte: new Date(now - RECENT_BAN_WINDOW_MS) },
		},
		orderBy: { createdAt: "desc" },
	});

	if (recentBan) {
		flags.push({
			type: AccountFlagType.JOINED_AFTER_BAN,
			details: {
				sanctionId: recentBan.id,
				minutesAfter: Math.round((now - recentBan.createdAt.getTime()) / 60_000),
			},
		});
	}

	if (!flags.length) return;

	await prisma.accountFlag.createMany({
		data: flags.map((flag) => ({
			guildId: member.guild.id,
			userId: member.id,
			type: flag.type,
			details: flag.details as Prisma.InputJsonValue,
		})),
	});

	await alertStaff(member, flags);
}
