import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@anubis/shared/prisma";
import {
	levelFromXp,
	progressFromXp,
	xpRequiredForLevel,
	type Paginated,
	type XpLeaderboardRowDto,
	type XpOverviewDto,
	type XpRewardRoleDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { paginate } from "../common/dto/pagination.dto";
import { GuildContextService } from "../common/guild-context.service";
import { toMemberRef, type DiscordUserLike } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type {
	CreateXpRewardRoleDto,
	UpdateXpRewardRoleDto,
	XpLeaderboardQueryDto,
} from "./dto/xp.dto";

/**
 * Experience des membres et paliers de recompense.
 *
 * `user_levels` appartient au bot : l'API la lit, ne l'ecrit jamais. La table
 * ne porte aucune cle etrangere vers `discord_users` (elle preexiste au
 * referentiel, et sa migration initiale est un `CREATE TABLE IF NOT EXISTS`) —
 * les membres sont donc resolus a la main, en un appel, comme les auteurs
 * Discord des concours.
 *
 * Les paliers, eux, se reglent ici et sont appliques par le bot. Ils ne suivent
 * pas le patron `discordSyncedAt` : un palier n'est pas un evenement a rejouer
 * une fois, c'est une regle permanente que le bot reevalue a chaque montee de
 * niveau et lors de son rattrapage periodique.
 */
@Injectable()
export class XpService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	private async resolveMembers(
		userIds: string[],
	): Promise<Map<string, DiscordUserLike>> {
		if (!userIds.length) return new Map();

		const users = await this.prisma.discordUser.findMany({
			where: { id: { in: userIds } },
		});

		return new Map(users.map((user) => [user.id, user]));
	}

	/**
	 * Membre absent du referentiel.
	 *
	 * Possible : le bot a pu compter de l'XP pour un compte qu'il n'a jamais
	 * enregistre (base heritee, referentiel purge). Afficher son identifiant
	 * vaut mieux que de le faire disparaitre du classement.
	 */
	private static placeholder(userId: string): DiscordUserLike {
		return { id: userId, username: userId, globalName: null, avatarUrl: null };
	}

	async leaderboard(
		query: XpLeaderboardQueryDto,
	): Promise<Paginated<XpLeaderboardRowDto>> {
		const guildId = this.guild.guildId;

		// La recherche porte sur le referentiel : `user_levels` ne connait que
		// des identifiants. Les comptes trouves bornent ensuite la requete d'XP.
		let userIdFilter: string[] | null = null;
		if (query.search) {
			const matches = await this.prisma.discordUser.findMany({
				where: {
					OR: [
						{ id: { contains: query.search } },
						{ username: { contains: query.search, mode: "insensitive" } },
						{ globalName: { contains: query.search, mode: "insensitive" } },
					],
				},
				select: { id: true },
			});
			userIdFilter = matches.map((match) => match.id);
		}

		const where: Prisma.UserLevelWhereInput = {
			guildId,
			xp: { gt: 0 },
			...(userIdFilter ? { userId: { in: userIdFilter } } : {}),
		};

		const [rows, total, rewards] = await Promise.all([
			this.prisma.userLevel.findMany({
				where,
				// `userId` departage les ex aequo : sans second critere, deux membres
				// a egalite pourraient permuter d'une page a l'autre et l'un des deux
				// disparaitre du classement.
				orderBy: [{ xp: "desc" }, { userId: "asc" }],
				skip: query.skip,
				take: query.take,
			}),
			this.prisma.userLevel.count({ where }),
			this.prisma.xpRewardRole.findMany({
				where: { guildId },
				orderBy: { level: "asc" },
			}),
		]);

		const members = await this.resolveMembers(rows.map((row) => row.userId));

		const items = rows.map((row, index) => {
			// L'XP est un BIGINT en base : converti ici pour que le reste du code
			// manipule un nombre ordinaire.
			const xp = Number(row.xp);
			const progress = progressFromXp(xp);

			return {
				member: toMemberRef(
					members.get(row.userId) ?? XpService.placeholder(row.userId),
				),
				// Le rang est celui de la page : la recherche filtre le classement,
				// elle ne le reordonne pas.
				rank: query.skip + index + 1,
				xp,
				level: progress.level,
				xpIntoLevel: progress.xpIntoLevel,
				xpForLevel: progress.xpForLevel,
				xpToNextLevel: progress.xpToNextLevel,
				ratio: progress.ratio,
				rewardRoleIds: rewards
					.filter((reward) => reward.level <= progress.level)
					.map((reward) => reward.roleId),
			} satisfies XpLeaderboardRowDto;
		});

		return paginate(items, total, query);
	}

	async overview(): Promise<XpOverviewDto> {
		const guildId = this.guild.guildId;

		const [aggregate, count, top] = await Promise.all([
			this.prisma.userLevel.aggregate({
				where: { guildId },
				_sum: { xp: true },
			}),
			this.prisma.userLevel.count({ where: { guildId, xp: { gt: 0 } } }),
			this.prisma.userLevel.findFirst({
				where: { guildId },
				orderBy: { xp: "desc" },
				select: { xp: true },
			}),
		]);

		return {
			rankedMemberCount: count,
			totalXp: Number(aggregate._sum.xp ?? 0n),
			highestLevel: levelFromXp(Number(top?.xp ?? 0n)),
			rewards: await this.listRewards(),
		};
	}

	/**
	 * Paliers de recompense, du plus bas au plus haut.
	 *
	 * Le nom du role vient du referentiel et vaut `null` quand le role n'y est
	 * pas (supprime sur Discord, ou identifiant saisi a la main avant que le bot
	 * ne l'ait vu). C'est ce qui rend visible un palier qui ne s'appliquera
	 * jamais, plutot que de le laisser echouer en silence cote bot.
	 */
	async listRewards(): Promise<XpRewardRoleDto[]> {
		const guildId = this.guild.guildId;

		const rewards = await this.prisma.xpRewardRole.findMany({
			where: { guildId },
			orderBy: { level: "asc" },
		});

		if (!rewards.length) return [];

		const roles = await this.prisma.role.findMany({
			where: { guildId, id: { in: rewards.map((reward) => reward.roleId) } },
			select: { id: true, name: true, color: true },
		});
		const byId = new Map(roles.map((role) => [role.id, role]));

		// Un seul comptage par palier plutot qu'une requete par ligne : les
		// paliers se comptent en dizaines au plus.
		const counts = await Promise.all(
			rewards.map((reward) =>
				this.prisma.userLevel.count({
					where: {
						guildId,
						xp: { gte: BigInt(xpRequiredForLevel(reward.level)) },
					},
				}),
			),
		);

		return rewards.map((reward, index) => {
			const role = byId.get(reward.roleId);

			return {
				id: reward.id,
				guildId: reward.guildId,
				roleId: reward.roleId,
				roleName: role?.name ?? null,
				roleColor: role?.color ?? null,
				level: reward.level,
				replacePrevious: reward.replacePrevious,
				eligibleMemberCount: counts[index]!,
				createdAt: reward.createdAt.toISOString(),
			} satisfies XpRewardRoleDto;
		});
	}

	async createReward(
		dto: CreateXpRewardRoleDto,
		actor: AuthenticatedUser,
	): Promise<XpRewardRoleDto> {
		const guildId = this.guild.guildId;

		const existing = await this.prisma.xpRewardRole.findUnique({
			where: { guildId_level: { guildId, level: dto.level } },
		});

		if (existing) {
			throw new ConflictException(
				`Un rôle est déjà attribué au niveau ${dto.level}.`,
			);
		}

		const saved = await this.prisma.xpRewardRole.create({
			data: {
				guildId,
				roleId: dto.roleId,
				level: dto.level,
				replacePrevious: dto.replacePrevious ?? false,
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "xp.reward.create",
			entityType: "xp_reward_role",
			entityId: saved.id,
			after: { roleId: saved.roleId, level: saved.level },
		});

		return this.findReward(saved.id);
	}

	async updateReward(
		id: string,
		dto: UpdateXpRewardRoleDto,
		actor: AuthenticatedUser,
	): Promise<XpRewardRoleDto> {
		const guildId = this.guild.guildId;

		const existing = await this.prisma.xpRewardRole.findFirst({
			where: { id, guildId },
		});
		if (!existing) throw new NotFoundException("Palier introuvable.");

		if (dto.level !== undefined && dto.level !== existing.level) {
			const clash = await this.prisma.xpRewardRole.findUnique({
				where: { guildId_level: { guildId, level: dto.level } },
			});
			if (clash) {
				throw new ConflictException(
					`Un rôle est déjà attribué au niveau ${dto.level}.`,
				);
			}
		}

		const saved = await this.prisma.xpRewardRole.update({
			where: { id },
			data: {
				...(dto.roleId !== undefined ? { roleId: dto.roleId } : {}),
				...(dto.level !== undefined ? { level: dto.level } : {}),
				...(dto.replacePrevious !== undefined
					? { replacePrevious: dto.replacePrevious }
					: {}),
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "xp.reward.update",
			entityType: "xp_reward_role",
			entityId: saved.id,
			before: { roleId: existing.roleId, level: existing.level },
			after: { roleId: saved.roleId, level: saved.level },
		});

		return this.findReward(saved.id);
	}

	/**
	 * Supprime un palier.
	 *
	 * Les roles deja distribues **restent** sur les membres : les retirer en
	 * masse toucherait des centaines de personnes pour une modification de
	 * reglage, et rien ne dit que le role n'a pas d'autre usage. Un palier
	 * supprime cesse simplement d'etre attribue.
	 */
	async removeReward(id: string, actor: AuthenticatedUser): Promise<void> {
		const existing = await this.prisma.xpRewardRole.findFirst({
			where: { id, guildId: this.guild.guildId },
		});
		if (!existing) throw new NotFoundException("Palier introuvable.");

		await this.prisma.xpRewardRole.delete({ where: { id } });

		await this.audit.record({
			appUserId: actor.id,
			action: "xp.reward.delete",
			entityType: "xp_reward_role",
			entityId: id,
			before: { roleId: existing.roleId, level: existing.level },
		});
	}

	private async findReward(id: string): Promise<XpRewardRoleDto> {
		const rewards = await this.listRewards();
		const reward = rewards.find((candidate) => candidate.id === id);

		if (!reward) throw new NotFoundException("Palier introuvable.");
		return reward;
	}

	/** Progression d'un membre, pour l'afficher sur sa fiche. */
	async memberProgress(userId: string): Promise<XpLeaderboardRowDto> {
		const guildId = this.guild.guildId;

		const row = await this.prisma.userLevel.findUnique({
			where: { userId_guildId: { userId, guildId } },
		});

		if (!row) {
			throw new NotFoundException("Ce membre n'a pas encore d'expérience.");
		}

		const xp = Number(row.xp);
		const progress = progressFromXp(xp);

		const [ahead, members, rewards] = await Promise.all([
			// Comptage plutot que tri complet : ramener toutes les lignes pour y
			// chercher un index couterait bien plus que de compter celles qui
			// devancent le membre.
			this.prisma.userLevel.count({
				where: { guildId, xp: { gt: row.xp } },
			}),
			this.resolveMembers([userId]),
			this.prisma.xpRewardRole.findMany({
				where: { guildId, level: { lte: progress.level } },
				orderBy: { level: "asc" },
			}),
		]);

		return {
			member: toMemberRef(members.get(userId) ?? XpService.placeholder(userId)),
			rank: ahead + 1,
			xp,
			level: progress.level,
			xpIntoLevel: progress.xpIntoLevel,
			xpForLevel: progress.xpForLevel,
			xpToNextLevel: progress.xpToNextLevel,
			ratio: progress.ratio,
			rewardRoleIds: rewards.map((reward) => reward.roleId),
		};
	}
}
