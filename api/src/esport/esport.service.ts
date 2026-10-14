import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EsportConfig, EsportMatch, EsportTeam, EsportWeek, Prisma } from "@anubis/shared/prisma";
import {
	addDaysToKey,
	buildEsportWeekEmbeds,
	DEFAULT_ESPORT_COLOR,
	DEFAULT_ESPORT_TITLE,
	esportEmbedsSize,
	esportRegion,
	resolveEsportRegionColors,
	ESPORT_TIME_ZONE,
	EMBED_LIMITS,
	EMBED_TOTAL_LIMIT,
	EsportMatchFormat,
	esportWeekStart,
	isDateKey,
	MAX_ESPORT_MATCHES_PER_WEEK,
	mondayOfKey,
	type EsportConfigDto,
	type EsportMatchDto,
	type EsportPublicationStatus,
	type EsportTeamDto,
	type EsportWeekDto,
	type EsportWeekSummaryDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { AppConfig } from "../config/configuration";
import { PrismaService } from "../prisma/prisma.service";
import type {
	EsportMatchDtoIn,
	EsportResultDtoIn,
	EsportTeamDtoIn,
	UpdateEsportConfigDto,
	UpdateEsportWeekDto,
} from "./dto/esport.dto";

/** Doivent rester identiques aux `@default` de `EsportConfig`. */
const CONFIG_DEFAULTS = {
	channelId: null as string | null,
	resultsChannelId: null as string | null,
	mentionRoleId: null as string | null,
	mentionOnPublish: true,
	mentionOnResult: false,
	spoilerScores: true,
	color: DEFAULT_ESPORT_COLOR,
	title: DEFAULT_ESPORT_TITLE,
	pandascoreLeagueIds: [5223] as number[],
	pandascoreSeries: [] as string[],
	regionColors: {} as Record<string, number>,
};

/** Limite de Discord : un recapitulatif compte un embed par region, « Autres » compris. */
const MAX_EMBEDS_PER_MESSAGE = 10;

const MATCH_INCLUDE = { teamA: true, teamB: true } as const;
const WEEK_INCLUDE = {
	matches: { include: MATCH_INCLUDE, orderBy: { scheduledAt: "asc" } },
} as const;

export type MatchRow = EsportMatch & { teamA: EsportTeam | null; teamB: EsportTeam | null };
type WeekRow = EsportWeek & { matches: MatchRow[] };
export type Tx = Prisma.TransactionClient;

export const toKey = (date: Date) => date.toISOString().slice(0, 10);
export const fromKey = (key: string) => new Date(`${key}T00:00:00Z`);

/**
 * Ou en est un message sur Discord.
 *
 * Meme lecture pour le recapitulatif et pour le resultat : demande de retrait,
 * puis brouillon, puis attente du bot, puis echec ou succes.
 */
function publicationStatus(row: {
	requested: boolean;
	syncedAt: Date | null;
	error: string | null;
	removalRequestedAt: Date | null;
}): EsportPublicationStatus {
	if (row.removalRequestedAt) return "REMOVING";
	if (!row.requested) return "DRAFT";
	if (!row.syncedAt) return "PENDING";
	return row.error ? "FAILED" : "PUBLISHED";
}

@Injectable()
export class EsportService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
		private readonly appConfig: ConfigService<{ app: AppConfig }, true>,
	) {}

	// -------------------------------------------------------------------------
	// Reglages
	// -------------------------------------------------------------------------

	async getConfig(): Promise<EsportConfigDto> {
		const row = await this.prisma.esportConfig.findUnique({
			where: { guildId: this.guild.guildId },
		});
		return this.toConfigDto(row);
	}

	async updateConfig(
		dto: UpdateEsportConfigDto,
		actor: AuthenticatedUser,
	): Promise<EsportConfigDto> {
		const guildId = this.guild.guildId;
		const data = Object.fromEntries(
			Object.entries(dto).filter(([, value]) => value !== undefined),
		) as Partial<typeof CONFIG_DEFAULTS>;

		if (data.title !== undefined) data.title = data.title.trim() || DEFAULT_ESPORT_TITLE;
		if (data.pandascoreLeagueIds !== undefined) {
			data.pandascoreLeagueIds = [...new Set(data.pandascoreLeagueIds)];
		}
		if (data.pandascoreSeries !== undefined) {
			data.pandascoreSeries = [
				...new Set(data.pandascoreSeries.map((motCle) => motCle.trim()).filter(Boolean)),
			];
		}
		if (data.regionColors !== undefined) {
			data.regionColors = this.validerCouleurs(data.regionColors);
		}

		const saved = await this.prisma.esportConfig.upsert({
			where: { guildId },
			update: data,
			create: { guildId, ...CONFIG_DEFAULTS, ...data },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.config.update",
			entityType: "esport_config",
			entityId: guildId,
			after: { ...data },
		});

		return this.toConfigDto(saved);
	}

	/**
	 * Couleurs des regions : codes connus et couleurs RGB seulement. On ne garde
	 * que ce qui s'ecarte du defaut, pour qu'une region jamais retouchee suive
	 * un changement de sa couleur par defaut.
	 */
	private validerCouleurs(couleurs: Record<string, number>): Record<string, number> {
		const gardees: Record<string, number> = {};
		for (const [code, couleur] of Object.entries(couleurs)) {
			const region = esportRegion(code);
			if (!region) throw new BadRequestException(`Région inconnue : ${code}.`);
			if (!Number.isInteger(couleur) || couleur < 0 || couleur > 0xffffff) {
				throw new BadRequestException(`Couleur invalide pour ${region.label}.`);
			}
			if (couleur !== region.color) gardees[region.code] = couleur;
		}
		return gardees;
	}

	private toConfigDto(row: EsportConfig | null): EsportConfigDto {
		const valeurs = row ?? CONFIG_DEFAULTS;
		return {
			channelId: valeurs.channelId,
			resultsChannelId: valeurs.resultsChannelId,
			mentionRoleId: valeurs.mentionRoleId,
			mentionOnPublish: valeurs.mentionOnPublish,
			mentionOnResult: valeurs.mentionOnResult,
			spoilerScores: valeurs.spoilerScores,
			color: valeurs.color,
			regionColors: resolveEsportRegionColors(valeurs.regionColors as Record<string, number>),
			title: valeurs.title,
			pandascore: {
				available: this.appConfig.get("app", { infer: true }).pandascore.available,
				leagueIds: valeurs.pandascoreLeagueIds,
				series: valeurs.pandascoreSeries,
			},
			updatedAt: row?.updatedAt.toISOString() ?? null,
		};
	}

	// -------------------------------------------------------------------------
	// Equipes
	// -------------------------------------------------------------------------

	async listTeams(): Promise<EsportTeamDto[]> {
		const rows = await this.prisma.esportTeam.findMany({
			where: { guildId: this.guild.guildId },
			orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
		});
		return rows.map((row) => this.toTeamDto(row));
	}

	async createTeam(dto: EsportTeamDtoIn, actor: AuthenticatedUser): Promise<EsportTeamDto> {
		const guildId = this.guild.guildId;
		const name = dto.name.trim();
		await this.assertTeamNameFree(name);

		const team = await this.prisma.esportTeam.create({
			data: {
				guildId,
				name,
				emoji: dto.emoji?.trim() || null,
				logoUrl: dto.logoUrl?.trim() || null,
				highlighted: dto.highlighted ?? false,
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.team.create",
			entityType: "esport_team",
			entityId: team.id,
			after: { name },
		});

		return this.toTeamDto(team);
	}

	/**
	 * Modifier une equipe repercute le changement sur les recapitulatifs deja
	 * publies de la semaine en cours et des suivantes : corriger un emoji doit
	 * se voir la ou l'equipe est annoncee. Les semaines passees ne bougent pas.
	 */
	async updateTeam(
		id: string,
		dto: EsportTeamDtoIn,
		actor: AuthenticatedUser,
	): Promise<EsportTeamDto> {
		const existing = await this.loadTeam(id);
		const name = dto.name.trim();
		if (name.toLowerCase() !== existing.name.toLowerCase()) {
			await this.assertTeamNameFree(name, id);
		}

		const team = await this.prisma.$transaction(async (tx) => {
			const updated = await tx.esportTeam.update({
				where: { id },
				data: {
					name,
					emoji: dto.emoji?.trim() || null,
					logoUrl: dto.logoUrl?.trim() || null,
					highlighted: dto.highlighted ?? existing.highlighted,
				},
			});

			const depuis = fromKey(addDaysToKey(esportWeekStart(new Date()), -7));
			await tx.esportWeek.updateMany({
				where: {
					guildId: this.guild.guildId,
					weekStart: { gte: depuis },
					publishRequestedAt: { not: null },
					removalRequestedAt: null,
					matches: { some: { OR: [{ teamAId: id }, { teamBId: id }] } },
				},
				data: { discordSyncedAt: null },
			});

			return updated;
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.team.update",
			entityType: "esport_team",
			entityId: id,
			before: { name: existing.name, emoji: existing.emoji },
			after: { name: team.name, emoji: team.emoji },
		});

		return this.toTeamDto(team);
	}

	/**
	 * Une equipe deja utilisee est **archivee**, jamais supprimee : les semaines
	 * passees doivent continuer de l'afficher. Elle disparait seulement des
	 * listes de choix.
	 */
	async removeTeam(id: string, actor: AuthenticatedUser): Promise<EsportTeamDto | null> {
		await this.loadTeam(id);

		const utilisations = await this.prisma.esportMatch.count({
			where: { OR: [{ teamAId: id }, { teamBId: id }] },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: utilisations ? "esport.team.archive" : "esport.team.delete",
			entityType: "esport_team",
			entityId: id,
		});

		if (utilisations) {
			const archived = await this.prisma.esportTeam.update({
				where: { id },
				data: { archivedAt: new Date() },
			});
			return this.toTeamDto(archived);
		}

		await this.prisma.esportTeam.delete({ where: { id } });
		return null;
	}

	async restoreTeam(id: string): Promise<EsportTeamDto> {
		const team = await this.loadTeam(id);
		await this.assertTeamNameFree(team.name, id);
		return this.toTeamDto(
			await this.prisma.esportTeam.update({ where: { id }, data: { archivedAt: null } }),
		);
	}

	private async loadTeam(id: string): Promise<EsportTeam> {
		const team = await this.prisma.esportTeam.findFirst({
			where: { id, guildId: this.guild.guildId },
		});
		if (!team) throw new NotFoundException("Équipe introuvable.");
		return team;
	}

	/** Deux equipes actives du meme nom rendraient le choix ambigu. */
	private async assertTeamNameFree(name: string, exceptId?: string): Promise<void> {
		const doublon = await this.prisma.esportTeam.findFirst({
			where: {
				guildId: this.guild.guildId,
				archivedAt: null,
				name: { equals: name, mode: "insensitive" },
				...(exceptId ? { id: { not: exceptId } } : {}),
			},
		});
		if (doublon) throw new ConflictException(`L'équipe « ${name} » existe déjà.`);
	}

	toTeamDto(row: EsportTeam): EsportTeamDto {
		return {
			id: row.id,
			name: row.name,
			emoji: row.emoji,
			logoUrl: row.logoUrl,
			highlighted: row.highlighted,
			archived: row.archivedAt !== null,
			pandascoreId: row.pandascoreId,
		};
	}

	// -------------------------------------------------------------------------
	// Semaines
	// -------------------------------------------------------------------------

	async listWeeks(): Promise<EsportWeekSummaryDto[]> {
		const rows = await this.prisma.esportWeek.findMany({
			where: { guildId: this.guild.guildId },
			orderBy: { weekStart: "desc" },
			take: 52,
			include: { matches: { select: { finishedAt: true } } },
		});

		return rows.map((row) => ({
			id: row.id,
			weekStart: toKey(row.weekStart),
			status: this.weekStatus(row),
			matchCount: row.matches.length,
			finishedCount: row.matches.filter((match) => match.finishedAt).length,
		}));
	}

	/** `null` plutot qu'une 404 : une semaine pas encore creee n'est pas une erreur. */
	async getWeek(weekStart: string): Promise<EsportWeekDto | null> {
		if (!isDateKey(weekStart)) throw new BadRequestException("Date invalide.");

		const row = await this.prisma.esportWeek.findUnique({
			where: {
				guildId_weekStart: {
					guildId: this.guild.guildId,
					weekStart: fromKey(mondayOfKey(weekStart)),
				},
			},
			include: WEEK_INCLUDE,
		});
		return row ? this.toWeekDto(row) : null;
	}

	async createWeek(weekStart: string, actor: AuthenticatedUser): Promise<EsportWeekDto> {
		if (!isDateKey(weekStart)) throw new BadRequestException("Date invalide.");
		const guildId = this.guild.guildId;
		const lundi = mondayOfKey(weekStart);

		const existing = await this.prisma.esportWeek.findUnique({
			where: { guildId_weekStart: { guildId, weekStart: fromKey(lundi) } },
		});
		if (existing) throw new ConflictException("Cette semaine existe déjà.");

		const row = await this.prisma.esportWeek.create({
			data: { guildId, weekStart: fromKey(lundi), createdById: actor.id },
			include: WEEK_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.week.create",
			entityType: "esport_week",
			entityId: row.id,
			after: { weekStart: lundi },
		});

		return this.toWeekDto(row);
	}

	async updateWeek(
		id: string,
		dto: UpdateEsportWeekDto,
		actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		await this.loadWeek(id);

		const data: Prisma.EsportWeekUpdateInput = {};
		if (dto.title !== undefined) data.title = dto.title?.trim() || null;
		if (dto.description !== undefined) data.description = dto.description?.trim() || null;

		await this.prisma.$transaction(async (tx) => {
			await tx.esportWeek.update({ where: { id }, data });
			await this.resynchroniser(tx, id);
			await this.verifierTaille(tx, id);
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.week.update",
			entityType: "esport_week",
			entityId: id,
			after: { ...dto },
		});

		return this.findWeek(id);
	}

	/** Supprimer la semaine du dashboard ne retire rien de Discord. */
	async deleteWeek(id: string, actor: AuthenticatedUser): Promise<void> {
		const week = await this.loadWeek(id);
		await this.prisma.esportWeek.delete({ where: { id } });

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.week.delete",
			entityType: "esport_week",
			entityId: id,
			before: { weekStart: toKey(week.weekStart) },
		});
	}

	/**
	 * Met la semaine en file : c'est le bot qui la publiera, ou corrigera le
	 * message deja publie. Rejouer l'envoi apres un echec passe par ici aussi.
	 */
	async publishWeek(id: string, actor: AuthenticatedUser): Promise<EsportWeekDto> {
		const week = await this.loadWeek(id);
		const config = await this.prisma.esportConfig.findUnique({
			where: { guildId: this.guild.guildId },
		});

		if (!config?.channelId) {
			throw new BadRequestException(
				"Aucun salon de publication n'est réglé : un administrateur doit le choisir dans les réglages.",
			);
		}

		const matchCount = await this.prisma.esportMatch.count({ where: { weekId: id } });
		if (!matchCount) {
			throw new BadRequestException("Ajoutez au moins un match avant d'envoyer la semaine.");
		}

		await this.prisma.esportWeek.update({
			where: { id },
			data: {
				publishRequestedAt: week.publishRequestedAt ?? new Date(),
				discordSyncedAt: null,
				lastError: null,
				removalRequestedAt: null,
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.week.publish",
			entityType: "esport_week",
			entityId: id,
		});

		return this.findWeek(id);
	}

	/**
	 * Retrait du message publie (administrateurs). La semaine redevient un
	 * brouillon une fois le message supprime par le bot : elle peut etre
	 * renvoyee.
	 */
	async removeWeekMessage(id: string, actor: AuthenticatedUser): Promise<EsportWeekDto> {
		const week = await this.loadWeek(id);
		if (!week.messageId) {
			throw new BadRequestException("Cette semaine n'a pas de message publié sur Discord.");
		}

		await this.prisma.esportWeek.update({
			where: { id },
			data: { removalRequestedAt: new Date() },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.week.remove-message",
			entityType: "esport_week",
			entityId: id,
		});

		return this.findWeek(id);
	}

	async loadWeek(id: string): Promise<EsportWeek> {
		const week = await this.prisma.esportWeek.findFirst({
			where: { id, guildId: this.guild.guildId },
		});
		if (!week) throw new NotFoundException("Semaine introuvable.");
		return week;
	}

	async findWeek(id: string): Promise<EsportWeekDto> {
		const row = await this.prisma.esportWeek.findUniqueOrThrow({
			where: { id },
			include: WEEK_INCLUDE,
		});
		return this.toWeekDto(row);
	}

	/**
	 * Toute modification d'une semaine deja envoyee la remet en file : le bot
	 * corrige le message publie. Un brouillon, lui, n'a rien a rattraper.
	 */
	async resynchroniser(tx: Tx, weekId: string): Promise<void> {
		await tx.esportWeek.updateMany({
			where: { id: weekId, publishRequestedAt: { not: null }, removalRequestedAt: null },
			data: { discordSyncedAt: null },
		});
	}

	/**
	 * Refuse une ecriture qui ferait deborder le recapitulatif : mieux vaut un
	 * refus ici, explique, qu'un echec du bot au moment de publier. Appelee dans
	 * la transaction, apres l'ecriture : le rendu porte sur l'etat final.
	 */
	async verifierTaille(tx: Tx, weekId: string): Promise<void> {
		const [week, config] = await Promise.all([
			tx.esportWeek.findUniqueOrThrow({ where: { id: weekId }, include: WEEK_INCLUDE }),
			tx.esportConfig.findUnique({ where: { guildId: this.guild.guildId } }),
		]);

		const embeds = buildEsportWeekEmbeds(
			{
				weekStart: toKey(week.weekStart),
				title: week.title,
				description: week.description,
				matches: week.matches.map((match) => this.toEmbedMatch(match)),
			},
			{
				title: config?.title ?? DEFAULT_ESPORT_TITLE,
				color: config?.color ?? DEFAULT_ESPORT_COLOR,
				spoilerScores: config?.spoilerScores ?? true,
				regionColors: (config?.regionColors ?? {}) as Record<string, number>,
			},
		);

		// Les 6000 caracteres portent sur l'ensemble des embeds du message.
		if (
			esportEmbedsSize(embeds) > EMBED_TOTAL_LIMIT ||
			embeds.length > MAX_EMBEDS_PER_MESSAGE ||
			embeds.some(
				(embed) =>
					embed.fields.length > EMBED_LIMITS.fields ||
					(embed.description?.length ?? 0) > EMBED_LIMITS.description,
			)
		) {
			throw new BadRequestException(
				"Le récapitulatif dépasserait la taille maximale d'un message Discord : raccourcissez des noms ou retirez des matchs.",
			);
		}
	}

	// -------------------------------------------------------------------------
	// Matchs
	// -------------------------------------------------------------------------

	async addMatch(
		weekId: string,
		dto: EsportMatchDtoIn,
		actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		const week = await this.loadWeek(weekId);

		const count = await this.prisma.esportMatch.count({ where: { weekId } });
		if (count >= MAX_ESPORT_MATCHES_PER_WEEK) {
			throw new BadRequestException(
				`Une semaine compte au plus ${MAX_ESPORT_MATCHES_PER_WEEK} matchs.`,
			);
		}

		const data = await this.validerMatch(week, dto, null);

		const match = await this.prisma.$transaction(async (tx) => {
			const created = await tx.esportMatch.create({ data: { weekId, ...data } });
			await this.resynchroniser(tx, weekId);
			await this.verifierTaille(tx, weekId);
			return created;
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.match.create",
			entityType: "esport_match",
			entityId: match.id,
		});

		return this.findWeek(weekId);
	}

	/**
	 * Un match deja termine dont on corrige l'equipe ou la competition voit son
	 * message de resultat corrige aussi.
	 */
	async updateMatch(
		id: string,
		dto: EsportMatchDtoIn,
		actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		const match = await this.loadMatch(id);
		const data = await this.validerMatch(match.week, dto, match);

		await this.prisma.$transaction(async (tx) => {
			await tx.esportMatch.update({
				where: { id },
				data: {
					...data,
					...(match.finishedAt ? { resultSyncedAt: null, resultError: null } : {}),
				},
			});
			await this.resynchroniser(tx, match.weekId);
			await this.verifierTaille(tx, match.weekId);
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.match.update",
			entityType: "esport_match",
			entityId: id,
		});

		return this.findWeek(match.weekId);
	}

	/** Le message de resultat eventuel reste sur Discord. */
	async deleteMatch(id: string, actor: AuthenticatedUser): Promise<EsportWeekDto> {
		const match = await this.loadMatch(id);

		await this.prisma.$transaction(async (tx) => {
			await tx.esportMatch.delete({ where: { id } });
			await this.resynchroniser(tx, match.weekId);
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.match.delete",
			entityType: "esport_match",
			entityId: id,
		});

		return this.findWeek(match.weekId);
	}

	/**
	 * Termine un match, ou corrige son score.
	 *
	 * Le score part toujours dans le recapitulatif de la semaine, corrige en
	 * place. Une annonce a part n'est publiee que si elle est demandee
	 * (`announce`) ; une annonce deja publiee est corrigee plutot que doublee,
	 * meme si la case a ete decochee depuis — la retirer reste une decision
	 * d'administrateur.
	 */
	async setResult(
		id: string,
		dto: EsportResultDtoIn,
		actor: AuthenticatedUser,
	): Promise<EsportWeekDto> {
		const match = await this.loadMatch(id);

		await this.prisma.$transaction(async (tx) => {
			await tx.esportMatch.update({
				where: { id },
				data: {
					scoreA: dto.scoreA,
					scoreB: dto.scoreB,
					spoiler: dto.spoiler,
					announceResult: dto.announce,
					finishedAt: match.finishedAt ?? new Date(),
					// Sans annonce ni message existant, le bot ne ramasse pas la ligne
					// (filtre de `publierResultats`) : la remettre a `null` est sans effet.
					resultSyncedAt: null,
					resultError: null,
					resultRemovalRequestedAt: null,
				},
			});
			await this.resynchroniser(tx, match.weekId);
			await this.verifierTaille(tx, match.weekId);
		});

		await this.audit.record({
			appUserId: actor.id,
			action: match.finishedAt ? "esport.match.result.update" : "esport.match.result",
			entityType: "esport_match",
			entityId: id,
			before: match.finishedAt ? { scoreA: match.scoreA, scoreB: match.scoreB } : undefined,
			after: { scoreA: dto.scoreA, scoreB: dto.scoreB, spoiler: dto.spoiler, announce: dto.announce },
		});

		return this.findWeek(match.weekId);
	}

	/**
	 * Rouvre un match termine par erreur. Le message de resultat deja publie
	 * n'est pas touche — le retirer reste une decision d'administrateur — mais
	 * il sera corrige, et non doublonne, si le match est termine de nouveau.
	 */
	async reopenMatch(id: string, actor: AuthenticatedUser): Promise<EsportWeekDto> {
		const match = await this.loadMatch(id);
		if (!match.finishedAt) throw new BadRequestException("Ce match n'est pas terminé.");

		await this.prisma.$transaction(async (tx) => {
			await tx.esportMatch.update({
				where: { id },
				data: { finishedAt: null, scoreA: null, scoreB: null },
			});
			await this.resynchroniser(tx, match.weekId);
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.match.reopen",
			entityType: "esport_match",
			entityId: id,
		});

		return this.findWeek(match.weekId);
	}

	/** Retrait du message de resultat (administrateurs). */
	async removeResultMessage(id: string, actor: AuthenticatedUser): Promise<EsportWeekDto> {
		const match = await this.loadMatch(id);
		if (!match.resultMessageId) {
			throw new BadRequestException("Ce match n'a pas de résultat publié sur Discord.");
		}

		await this.prisma.esportMatch.update({
			where: { id },
			data: { resultRemovalRequestedAt: new Date() },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.match.result.remove-message",
			entityType: "esport_match",
			entityId: id,
		});

		return this.findWeek(match.weekId);
	}

	async loadMatch(id: string): Promise<EsportMatch & { week: EsportWeek }> {
		const match = await this.prisma.esportMatch.findFirst({
			where: { id, week: { guildId: this.guild.guildId } },
			include: { week: true },
		});
		if (!match) throw new NotFoundException("Match introuvable.");
		return match;
	}

	/**
	 * Trois verifications :
	 * - les equipes existent sur ce serveur, et une equipe archivee n'est
	 *   acceptee que si le match la portait deja ;
	 * - une equipe ne joue pas contre elle-meme ;
	 * - le match tombe dans sa semaine, **a l'heure de Paris** : un match du
	 *   dimanche 23 h 30 n'appartient pas a la semaine suivante.
	 */
	private async validerMatch(
		week: EsportWeek,
		dto: EsportMatchDtoIn,
		existing: EsportMatch | null,
	) {
		if (dto.teamAId && dto.teamAId === dto.teamBId) {
			throw new BadRequestException("Une équipe ne peut pas jouer contre elle-même.");
		}

		const ids = [dto.teamAId, dto.teamBId].filter((id): id is string => !!id);
		if (ids.length) {
			const teams = await this.prisma.esportTeam.findMany({
				where: { id: { in: ids }, guildId: this.guild.guildId },
			});
			for (const id of ids) {
				const team = teams.find((entry) => entry.id === id);
				const dejaLa = existing && (existing.teamAId === id || existing.teamBId === id);
				if (!team || (team.archivedAt && !dejaLa)) {
					throw new BadRequestException("Équipe introuvable ou archivée.");
				}
			}
		}

		const scheduledAt = new Date(dto.scheduledAt);
		if (esportWeekStart(scheduledAt) !== toKey(week.weekStart)) {
			throw new BadRequestException(
				"Ce match ne tombe pas dans cette semaine (du lundi 06:00 au lundi suivant 05:59, heure de Paris).",
			);
		}

		return {
			teamAId: dto.teamAId,
			teamBId: dto.teamBId,
			competition: dto.competition?.trim() || null,
			region: dto.region ?? null,
			scheduledAt,
			format: dto.format ?? existing?.format ?? EsportMatchFormat.BEST_OF,
			bestOf: dto.bestOf ?? null,
			streamUrl: dto.streamUrl?.trim() || null,
		};
	}

	// -------------------------------------------------------------------------
	// Mappers
	// -------------------------------------------------------------------------

	private weekStatus(row: EsportWeek): EsportPublicationStatus {
		return publicationStatus({
			requested: row.publishRequestedAt !== null,
			syncedAt: row.discordSyncedAt,
			error: row.lastError,
			removalRequestedAt: row.removalRequestedAt,
		});
	}

	private toWeekDto(row: WeekRow): EsportWeekDto {
		return {
			id: row.id,
			weekStart: toKey(row.weekStart),
			title: row.title,
			description: row.description,
			status: this.weekStatus(row),
			messageId: row.messageId,
			lastError: row.lastError,
			publishedAt: row.publishedAt?.toISOString() ?? null,
			matches: row.matches.map((match) => this.toMatchDto(match)),
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	private toMatchDto(row: MatchRow): EsportMatchDto {
		const finished = row.finishedAt !== null;
		return {
			id: row.id,
			weekId: row.weekId,
			teamA: row.teamA ? this.toTeamDto(row.teamA) : null,
			teamB: row.teamB ? this.toTeamDto(row.teamB) : null,
			competition: row.competition,
			region: row.region,
			scheduledAt: row.scheduledAt.toISOString(),
			format: row.format,
			bestOf: row.bestOf,
			streamUrl: row.streamUrl,
			pandascoreId: row.pandascoreId,
			finished,
			scoreA: row.scoreA,
			scoreB: row.scoreB,
			spoiler: row.spoiler,
			announceResult: row.announceResult,
			// Sans annonce demandee ni message publie, il n'y a rien a suivre :
			// le score vit dans le recapitulatif.
			result:
				(finished && row.announceResult) || row.resultMessageId
					? {
							status: publicationStatus({
								requested: true,
								syncedAt: row.resultSyncedAt,
								error: row.resultError,
								removalRequestedAt: row.resultRemovalRequestedAt,
							}),
							messageId: row.resultMessageId,
							error: row.resultError,
						}
					: null,
		};
	}

	private toEmbedMatch(row: MatchRow) {
		return {
			teamA: row.teamA,
			teamB: row.teamB,
			competition: row.competition,
			region: row.region,
			scheduledAt: row.scheduledAt,
			format: row.format,
			bestOf: row.bestOf,
			streamUrl: row.streamUrl,
			pandascoreId: row.pandascoreId,
			finished: row.finishedAt !== null,
			scoreA: row.scoreA,
			scoreB: row.scoreB,
			spoiler: row.spoiler,
		};
	}
}
