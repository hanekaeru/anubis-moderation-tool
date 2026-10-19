import {
	BadRequestException,
	Injectable,
	Logger,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EsportTeam, Prisma } from "@anubis/shared/prisma";
import {
	addDaysToKey,
	esportDayKey,
	esportDayLabel,
	esportFormatLabel,
	esportRegionLabel,
	esportWeekStart,
	liquipediaPageLabel,
	ESPORT_DAY_START,
	ESPORT_TIME_ZONE,
	LIQUIPEDIA_REFRESH_COOLDOWN_MS,
	MAX_ESPORT_MATCHES_PER_WEEK,
	zonedTimeOfDay,
	zonedWallTimeToUtc,
	type EsportWeekDto,
	type LiquipediaMatchDto,
	type LiquipediaScoresDto,
	type LiquipediaTeamDto,
	type LiquipediaWeekDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { AppConfig } from "../config/configuration";
import { PrismaService } from "../prisma/prisma.service";
import { EsportService, fromKey, toKey, type MatchRow, type Tx } from "./esport.service";
import {
	fetchLiquipediaMatches,
	isFollowed,
	LiquipediaError,
	readLiquipediaMatch,
	trimLiquipediaMatch,
	type LiquipediaMatch,
	type LiquipediaRawMatch,
} from "./liquipedia.client";

/** Au-dela, une semaine passee n'a plus rien a proposer : son cache est purge. */
const CACHE_RETENTION_MS = 120 * 24 * 3600_000;
/** Doivent rester identiques aux `@default` de `EsportConfig`. */
const DEFAULT_SERIES = ["Overwatch Champions Series"];

const memesSeries = (a: readonly string[], b: readonly string[]) =>
	[...a].sort().join("|") === [...b].sort().join("|");

const quand = (date: Date) =>
	`${esportDayLabel(esportDayKey(date))} ${zonedTimeOfDay(date, ESPORT_TIME_ZONE)}`;

const nomLocal = (team: EsportTeam | null) => team?.name ?? "À déterminer";
const nomLiquipedia = (team: LiquipediaTeamDto | null) => team?.name ?? "À déterminer";

/** Une proposition retiree : plus rien a valider. */
const SANS_PROPOSITION = {
	suggestedScoreA: null,
	suggestedScoreB: null,
	suggestedForfeit: false,
	suggestedAt: null,
} as const;

interface Reglages {
	series: string[];
	keywords: string[];
	firstTo: boolean;
}

/**
 * Import des matchs, et releve des scores, depuis Liquipedia DB.
 *
 * Trois couches, et un seul va-et-vient avec Liquipedia :
 * - **le cache** (`liquipedia_matches`) garde la reponse telle que recue. Le
 *   staff ne le modifie jamais ; il n'est reecrit que par un appel.
 * - **la semaine** composee reste la seule chose publiee. Un import y copie
 *   des matchs, que le staff corrige ensuite librement.
 * - **rien n'est automatique** : ni appel planifie, ni creation de match, ni
 *   publication, ni score. L'appel part quand quelqu'un ouvre l'import d'une
 *   semaine jamais recuperee, clique « Actualiser » ou « Recuperer les
 *   scores » ; un match n'entre dans la semaine que coche ; un score releve
 *   n'est qu'une proposition, que « Terminer » valide.
 */
@Injectable()
export class EsportImportService {
	private readonly logger = new Logger(EsportImportService.name);
	/** Un seul appel en vol par semaine : deux clics simultanes n'en coutent qu'un. */
	private readonly enVol = new Map<string, Promise<void>>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
		private readonly appConfig: ConfigService<{ app: AppConfig }, true>,
		private readonly esport: EsportService,
	) {}

	private get apiKey(): string {
		return this.appConfig.get("app", { infer: true }).liquipedia.apiKey;
	}

	private async reglages(): Promise<Reglages> {
		const row = await this.prisma.esportConfig.findUnique({
			where: { guildId: this.guild.guildId },
			select: { liquipediaSeries: true, liquipediaKeywords: true, liquipediaFirstTo: true },
		});
		return {
			series: row?.liquipediaSeries ?? DEFAULT_SERIES,
			keywords: row?.liquipediaKeywords ?? [],
			firstTo: row?.liquipediaFirstTo ?? true,
		};
	}

	/** Lundi 06:00 -> lundi suivant 05:59:59, heure de Paris (`ESPORT_DAY_START`). */
	private bornes(weekStart: string): { from: Date; to: Date } {
		const from = zonedWallTimeToUtc(weekStart, ESPORT_DAY_START, ESPORT_TIME_ZONE);
		const lundiSuivant = zonedWallTimeToUtc(addDaysToKey(weekStart, 7), ESPORT_DAY_START, ESPORT_TIME_ZONE);
		return { from, to: new Date(lundiSuivant.getTime() - 1000) };
	}

	private exigerCle(): void {
		if (!this.apiKey) {
			throw new ServiceUnavailableException(
				"L'import Liquipedia n'est pas configuré sur ce serveur (LIQUIPEDIA_API_KEY).",
			);
		}
	}

	private exigerSeries(series: string[]): void {
		if (!series.length) {
			throw new BadRequestException(
				"Aucune série Liquipedia n'est réglée : un administrateur doit en choisir une dans les réglages.",
			);
		}
	}

	private refreshableAt(fetchedAt: Date | null | undefined): string | null {
		return fetchedAt ? new Date(fetchedAt.getTime() + LIQUIPEDIA_REFRESH_COOLDOWN_MS).toISOString() : null;
	}

	// -------------------------------------------------------------------------
	// Cache
	// -------------------------------------------------------------------------

	/**
	 * Matchs Liquipedia de la semaine, mis en regard de ceux deja importes.
	 *
	 * Lit le cache ; n'appelle Liquipedia que si la semaine n'a jamais ete
	 * recuperee, ou l'a ete pour d'autres series que celles reglees aujourd'hui.
	 */
	async weekView(weekId: string): Promise<LiquipediaWeekDto> {
		const week = await this.esport.loadWeek(weekId);
		if (!this.apiKey) {
			return { available: false, fetchedAt: null, refreshableAt: null, matches: [], missing: [] };
		}

		const weekStart = toKey(week.weekStart);
		const reglages = await this.reglages();
		this.exigerSeries(reglages.series);

		let appel = await this.prisma.liquipediaFetch.findUnique({ where: { weekStart: week.weekStart } });
		if (!appel || !memesSeries(appel.series, reglages.series)) {
			await this.actualiser(weekStart, reglages.series);
			appel = await this.prisma.liquipediaFetch.findUnique({ where: { weekStart: week.weekStart } });
		}

		const [caches, locaux] = await Promise.all([
			this.lireCache(weekStart, reglages),
			this.prisma.esportMatch.findMany({
				where: { weekId, liquipediaId: { not: null } },
				include: { teamA: true, teamB: true },
			}),
		]);

		const parId = new Map(locaux.map((local) => [local.liquipediaId!, local]));
		const presents = new Set(caches.map((match) => match.id));

		return {
			available: true,
			fetchedAt: appel?.fetchedAt.toISOString() ?? null,
			refreshableAt: this.refreshableAt(appel?.fetchedAt),
			matches: caches.map((match) => {
				const local = parId.get(match.id);
				return {
					...this.toDto(match),
					followed: isFollowed(match, reglages.keywords),
					importedMatchId: local?.id ?? null,
					differences: local ? this.differences(local, match) : [],
				};
			}),
			missing: locaux
				.filter((local) => !presents.has(local.liquipediaId!))
				.map((local) => ({
					matchId: local.id,
					label: `${nomLocal(local.teamA)} vs ${nomLocal(local.teamB)}`,
				})),
		};
	}

	/** « Actualiser » : un appel, refuse s'il en est parti un il y a moins de deux minutes. */
	async refresh(weekId: string): Promise<LiquipediaWeekDto> {
		const week = await this.esport.loadWeek(weekId);
		this.exigerCle();
		const { series } = await this.reglages();
		this.exigerSeries(series);

		const appel = await this.prisma.liquipediaFetch.findUnique({ where: { weekStart: week.weekStart } });
		if (appel && memesSeries(appel.series, series)) {
			const permis = appel.fetchedAt.getTime() + LIQUIPEDIA_REFRESH_COOLDOWN_MS;
			if (Date.now() < permis) {
				throw new BadRequestException(
					`Les données datent de moins de deux minutes : nouvelle actualisation possible à ${zonedTimeOfDay(
						new Date(permis),
						ESPORT_TIME_ZONE,
					)}.`,
				);
			}
		}

		await this.actualiser(toKey(week.weekStart), series);
		return this.weekView(weekId);
	}

	private actualiser(weekStart: string, series: string[]): Promise<void> {
		const enCours = this.enVol.get(weekStart);
		if (enCours) return enCours;

		const promesse = this.appeler(weekStart, series).finally(() => this.enVol.delete(weekStart));
		this.enVol.set(weekStart, promesse);
		return promesse;
	}

	private async appeler(weekStart: string, series: string[]): Promise<void> {
		const { from, to } = this.bornes(weekStart);

		let bruts: LiquipediaRawMatch[];
		try {
			bruts = await fetchLiquipediaMatches({ apiKey: this.apiKey, series, from, to });
		} catch (err) {
			if (err instanceof LiquipediaError) {
				this.logger.warn(`Appel Liquipedia échoué (semaine du ${weekStart}) : ${err.message}`);
				// 400 et non 502 : le message s'affiche dans la fenetre d'import,
				// la ou l'on peut reessayer, plutot qu'en notification volante.
				throw new BadRequestException(err.message);
			}
			throw err;
		}

		// La lecture ecarte les matchs sans horaire ; le reglage BO/FT n'y joue pas.
		const lus = bruts.filter((raw) => readLiquipediaMatch(raw, { firstTo: false }) !== null);
		const maintenant = new Date();
		const limite = new Date(maintenant.getTime() - CACHE_RETENTION_MS);

		await this.prisma.$transaction(
			async (tx) => {
				for (const raw of lus) {
					const lu = readLiquipediaMatch(raw, { firstTo: false })!;
					const champs = {
						series: lu.series.slice(0, 200),
						scheduledAt: lu.scheduledAt,
						finished: lu.finished,
						data: trimLiquipediaMatch(raw) as unknown as Prisma.InputJsonValue,
						fetchedAt: maintenant,
					};
					await tx.liquipediaMatch.upsert({
						where: { id: raw.match2id },
						update: champs,
						create: { id: raw.match2id, ...champs },
					});
				}

				// Absent de la reponse : deplace dans une autre semaine, ou retire.
				// Il reapparaitra dans le cache de sa nouvelle semaine.
				await tx.liquipediaMatch.deleteMany({
					where: {
						series: { in: series },
						scheduledAt: { gte: from, lte: to },
						id: { notIn: lus.map((raw) => raw.match2id) },
					},
				});

				await tx.liquipediaFetch.upsert({
					where: { weekStart: fromKey(weekStart) },
					update: { series, matchCount: lus.length, fetchedAt: maintenant },
					create: { weekStart: fromKey(weekStart), series, matchCount: lus.length, fetchedAt: maintenant },
				});

				await tx.liquipediaMatch.deleteMany({ where: { scheduledAt: { lt: limite } } });
				await tx.liquipediaFetch.deleteMany({ where: { weekStart: { lt: limite } } });
			},
			{ timeout: 20_000 },
		);
	}

	private async lireCache(weekStart: string, reglages: Reglages): Promise<LiquipediaMatch[]> {
		const { from, to } = this.bornes(weekStart);
		const rows = await this.prisma.liquipediaMatch.findMany({
			where: { series: { in: reglages.series }, scheduledAt: { gte: from, lte: to } },
			orderBy: { scheduledAt: "asc" },
		});
		return rows
			.map((row) => readLiquipediaMatch(row.data as unknown as LiquipediaRawMatch, reglages))
			.filter((match): match is LiquipediaMatch => match !== null);
	}

	private toDto(
		match: LiquipediaMatch,
	): Omit<LiquipediaMatchDto, "followed" | "importedMatchId" | "differences"> {
		return {
			id: match.id,
			scheduledAt: match.scheduledAt.toISOString(),
			dateExact: match.dateExact,
			status: match.status,
			competition: match.competition,
			region: match.region,
			tournament: match.tournament,
			page: match.page,
			format: match.format,
			games: match.games,
			teamA: match.teamA,
			teamB: match.teamB,
			score: match.score,
			forfeit: match.forfeit,
			streamUrl: match.streamUrl,
		};
	}

	/**
	 * Ce qu'un nouvel import changerait. Le score n'y figure pas : il ne passe
	 * jamais par l'import, seulement par « Recuperer les scores » et « Terminer ».
	 */
	private differences(local: MatchRow, match: LiquipediaMatch): string[] {
		const diffs: string[] = [];

		if (local.scheduledAt.getTime() !== match.scheduledAt.getTime()) {
			diffs.push(`Horaire : ${quand(local.scheduledAt)} → ${quand(match.scheduledAt)}`);
		}

		if (
			(local.teamA?.liquipediaName ?? null) !== (match.teamA?.key ?? null) ||
			(local.teamB?.liquipediaName ?? null) !== (match.teamB?.key ?? null)
		) {
			diffs.push(
				`Équipes : ${nomLocal(local.teamA)} vs ${nomLocal(local.teamB)} → ${nomLiquipedia(
					match.teamA,
				)} vs ${nomLiquipedia(match.teamB)}`,
			);
		}

		const formatLocal = esportFormatLabel(local.format, local.bestOf) ?? "—";
		const formatLiquipedia = esportFormatLabel(match.format, match.games) ?? "—";
		if (formatLocal !== formatLiquipedia) diffs.push(`Format : ${formatLocal} → ${formatLiquipedia}`);

		if ((local.competition ?? "") !== match.competition) {
			diffs.push(`Compétition : « ${local.competition ?? "—"} » → « ${match.competition} »`);
		}

		if ((local.region ?? null) !== match.region) {
			diffs.push(
				`Région : ${esportRegionLabel(local.region) ?? "aucune"} → ${esportRegionLabel(match.region) ?? "aucune"}`,
			);
		}

		if ((local.streamUrl ?? null) !== match.streamUrl) diffs.push("Lien du stream");

		if ((local.liquipediaPage ?? null) !== match.page) {
			diffs.push(`Page source : ${match.page ? liquipediaPageLabel(match.page) : "aucune"}`);
		}

		return diffs;
	}

	// -------------------------------------------------------------------------
	// Import
	// -------------------------------------------------------------------------

	/**
	 * Copie les matchs coches dans la semaine. Lit le **cache**, jamais
	 * Liquipedia : ce qui est importe est exactement ce que le staff a vu.
	 *
	 * Un match deja importe est mis a jour (horaire, equipes, format, stream,
	 * competition, page source) ; son score, son spoiler et ses messages ne
	 * bougent pas.
	 */
	async import(weekId: string, ids: string[], actor: AuthenticatedUser): Promise<EsportWeekDto> {
		const week = await this.esport.loadWeek(weekId);
		this.exigerCle();
		const reglages = await this.reglages();

		const weekStart = toKey(week.weekStart);
		const uniques = [...new Set(ids)];

		const rows = await this.prisma.liquipediaMatch.findMany({ where: { id: { in: uniques } } });
		const lus = new Map<string, LiquipediaMatch>();
		for (const row of rows) {
			const match = readLiquipediaMatch(row.data as unknown as LiquipediaRawMatch, reglages);
			if (match) lus.set(row.id, match);
		}

		for (const id of uniques) {
			const match = lus.get(id);
			if (!match) {
				throw new BadRequestException(
					"Un des matchs choisis n'est plus dans les données Liquipedia : actualisez la liste.",
				);
			}
			if (esportWeekStart(match.scheduledAt) !== weekStart) {
				throw new BadRequestException(
					`${nomLiquipedia(match.teamA)} vs ${nomLiquipedia(match.teamB)} n'est plus prévu cette semaine sur Liquipedia : actualisez la liste.`,
				);
			}
		}

		const existants = await this.prisma.esportMatch.findMany({
			where: { weekId, liquipediaId: { in: uniques } },
		});
		const dejaLa = new Map(existants.map((match) => [match.liquipediaId!, match]));

		const total = await this.prisma.esportMatch.count({ where: { weekId } });
		const nouveaux = uniques.filter((id) => !dejaLa.has(id)).length;
		if (total + nouveaux > MAX_ESPORT_MATCHES_PER_WEEK) {
			throw new BadRequestException(
				`Une semaine compte au plus ${MAX_ESPORT_MATCHES_PER_WEEK} matchs : il reste ${Math.max(
					0,
					MAX_ESPORT_MATCHES_PER_WEEK - total,
				)} place(s).`,
			);
		}

		await this.prisma.$transaction(
			async (tx) => {
				for (const id of uniques) {
					const match = lus.get(id)!;
					const data = {
						teamAId: await this.equipe(tx, match.teamA),
						teamBId: await this.equipe(tx, match.teamB),
						competition: match.competition,
						region: match.region,
						scheduledAt: match.scheduledAt,
						format: match.format,
						bestOf: match.games,
						streamUrl: match.streamUrl,
						liquipediaPage: match.page,
					};

					const existant = dejaLa.get(id);
					if (existant) {
						await tx.esportMatch.update({
							where: { id: existant.id },
							data: {
								...data,
								// Un resultat deja annonce reprend les equipes corrigees.
								...(existant.finishedAt ? { resultSyncedAt: null, resultError: null } : {}),
							},
						});
					} else {
						await tx.esportMatch.create({ data: { weekId, liquipediaId: id, ...data } });
					}
				}

				await this.esport.resynchroniser(tx, weekId);
				await this.esport.verifierTaille(tx, weekId);
			},
			{ timeout: 20_000 },
		);

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.match.import",
			entityType: "esport_week",
			entityId: weekId,
			after: { liquipediaIds: uniques, created: nouveaux, updated: uniques.length - nouveaux },
		});

		return this.esport.findWeek(weekId);
	}

	/**
	 * Equipe du dashboard correspondant a une equipe Liquipedia, creee au besoin.
	 *
	 * Par nom Liquipedia d'abord ; puis par nom affiche, pour relier une equipe
	 * saisie a la main avant l'import (elle garde son emoji et son logo) ; sinon
	 * creee avec le nom de Liquipedia et sans logo, que le staff peut ajouter.
	 * Une equipe reliee mais archivee est restauree : elle rejoue.
	 */
	private async equipe(tx: Tx, team: LiquipediaTeamDto | null): Promise<string | null> {
		if (!team) return null;
		const guildId = this.guild.guildId;

		const liee = await tx.esportTeam.findUnique({
			where: { guildId_liquipediaName: { guildId, liquipediaName: team.key } },
		});
		if (liee) {
			if (liee.archivedAt) {
				await tx.esportTeam.update({ where: { id: liee.id }, data: { archivedAt: null } });
			}
			return liee.id;
		}

		const homonyme = await tx.esportTeam.findFirst({
			where: {
				guildId,
				archivedAt: null,
				liquipediaName: null,
				name: { equals: team.name, mode: "insensitive" },
			},
		});
		if (homonyme) {
			await tx.esportTeam.update({
				where: { id: homonyme.id },
				data: { liquipediaName: team.key },
			});
			return homonyme.id;
		}

		// Nom deja pris par une autre equipe reliee : la mention departage.
		const pris = await tx.esportTeam.findFirst({
			where: { guildId, archivedAt: null, name: { equals: team.name, mode: "insensitive" } },
		});
		const creee = await tx.esportTeam.create({
			data: {
				guildId,
				name: (pris ? `${team.name} (Liquipedia)` : team.name).slice(0, 80),
				liquipediaName: team.key,
			},
		});
		return creee.id;
	}

	// -------------------------------------------------------------------------
	// Scores
	// -------------------------------------------------------------------------

	/**
	 * « Recuperer les scores » : releve sur Liquipedia le score des matchs
	 * importes de la semaine et le pose **en proposition** sur chacun.
	 *
	 * Rien d'autre ne bouge : ni le score, ni le recapitulatif, ni Discord. Le
	 * staff valide match par match avec « Terminer », qui reste le seul chemin
	 * vers un score publie. Une proposition n'est posee que si elle apporte
	 * quelque chose — match pas encore termine, ou score saisi different — et
	 * retiree quand elle n'a plus lieu d'etre.
	 *
	 * Rappelle Liquipedia si les donnees ont plus de deux minutes, et se
	 * contente du cache sinon : le bouton ne doit jamais repondre par un refus.
	 */
	async fetchScores(weekId: string, actor: AuthenticatedUser): Promise<LiquipediaScoresDto> {
		const week = await this.esport.loadWeek(weekId);
		this.exigerCle();
		const reglages = await this.reglages();
		this.exigerSeries(reglages.series);

		const appel = await this.prisma.liquipediaFetch.findUnique({ where: { weekStart: week.weekStart } });
		const refreshed =
			!appel ||
			!memesSeries(appel.series, reglages.series) ||
			Date.now() >= appel.fetchedAt.getTime() + LIQUIPEDIA_REFRESH_COOLDOWN_MS;
		if (refreshed) await this.actualiser(toKey(week.weekStart), reglages.series);

		const locaux = await this.prisma.esportMatch.findMany({
			where: { weekId, liquipediaId: { not: null } },
			include: { teamA: true, teamB: true },
		});
		const rows = await this.prisma.liquipediaMatch.findMany({
			where: { id: { in: locaux.map((local) => local.liquipediaId!) } },
		});
		const caches = new Map(rows.map((row) => [row.id, row]));

		let suggested = 0;
		await this.prisma.$transaction(async (tx) => {
			for (const local of locaux) {
				const row = caches.get(local.liquipediaId!);
				const match = row
					? readLiquipediaMatch(row.data as unknown as LiquipediaRawMatch, reglages)
					: null;
				const score = match ? this.scoreLocal(local, match) : null;
				const utile =
					score !== null &&
					(!local.finishedAt || local.scoreA !== score.a || local.scoreB !== score.b);

				if (utile) {
					suggested++;
					const inchange =
						local.suggestedScoreA === score.a &&
						local.suggestedScoreB === score.b &&
						local.suggestedForfeit === match!.forfeit;
					if (!inchange || !local.suggestedAt) {
						await tx.esportMatch.update({
							where: { id: local.id },
							data: {
								suggestedScoreA: score.a,
								suggestedScoreB: score.b,
								suggestedForfeit: match!.forfeit,
								suggestedAt: row!.fetchedAt,
							},
						});
					}
				} else if (local.suggestedAt) {
					await tx.esportMatch.update({ where: { id: local.id }, data: SANS_PROPOSITION });
				}
			}
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "esport.match.scores.fetch",
			entityType: "esport_week",
			entityId: weekId,
			after: { refreshed, suggested },
		});

		const dernier = await this.prisma.liquipediaFetch.findUnique({ where: { weekStart: week.weekStart } });
		return {
			week: await this.esport.findWeek(weekId),
			fetchedAt: dernier?.fetchedAt.toISOString() ?? null,
			refreshed,
			suggested,
		};
	}

	/** « Ignorer » : retire la proposition sans toucher au match. */
	async dismissSuggestion(matchId: string, actor: AuthenticatedUser): Promise<EsportWeekDto> {
		const match = await this.esport.loadMatch(matchId);
		if (match.suggestedAt) {
			await this.prisma.esportMatch.update({ where: { id: matchId }, data: SANS_PROPOSITION });
			await this.audit.record({
				appUserId: actor.id,
				action: "esport.match.suggestion.dismiss",
				entityType: "esport_match",
				entityId: matchId,
				before: { scoreA: match.suggestedScoreA, scoreB: match.suggestedScoreB },
			});
		}
		return this.esport.findWeek(match.weekId);
	}

	/**
	 * Score Liquipedia dans l'ordre des equipes du dashboard. Les equipes
	 * reliees donnent l'ordre local, meme si le staff les a inversees ; sinon,
	 * l'ordre de Liquipedia.
	 */
	private scoreLocal(local: MatchRow, match: LiquipediaMatch): { a: number; b: number } | null {
		if (!match.score) return null;
		const cleA = local.teamA?.liquipediaName;
		const cleB = local.teamB?.liquipediaName;
		if (cleA && cleB && cleA === match.teamB?.key && cleB === match.teamA?.key) {
			return { a: match.score.b, b: match.score.a };
		}
		return match.score;
	}
}
