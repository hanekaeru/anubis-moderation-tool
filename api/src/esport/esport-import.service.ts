import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
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
	ESPORT_DAY_START,
	ESPORT_TIME_ZONE,
	MAX_ESPORT_MATCHES_PER_WEEK,
	PANDASCORE_REFRESH_COOLDOWN_MS,
	zonedTimeOfDay,
	zonedWallTimeToUtc,
	type EsportWeekDto,
	type PandascoreMatchDto,
	type PandascoreResultSuggestionDto,
	type PandascoreTeamDto,
	type PandascoreWeekDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { AppConfig } from "../config/configuration";
import { PrismaService } from "../prisma/prisma.service";
import { EsportService, fromKey, toKey, type MatchRow, type Tx } from "./esport.service";
import {
	fetchOverwatchMatches,
	isFollowed,
	PandascoreError,
	readPandascoreMatch,
	type PandascoreMatch,
	type PandascoreRawMatch,
} from "./pandascore.client";

/** Au-dela, une semaine passee n'a plus rien a proposer : son cache est purge. */
const CACHE_RETENTION_MS = 120 * 24 * 3600_000;
const DEFAULT_LEAGUE_IDS = [5223];

const memesLigues = (a: readonly number[], b: readonly number[]) =>
	[...a].sort((x, y) => x - y).join(",") === [...b].sort((x, y) => x - y).join(",");

const quand = (date: Date) =>
	`${esportDayLabel(esportDayKey(date))} ${zonedTimeOfDay(date, ESPORT_TIME_ZONE)}`;

const nomLocal = (team: EsportTeam | null) => team?.name ?? "À déterminer";
const nomPandascore = (team: PandascoreTeamDto | null) => team?.name ?? "À déterminer";

/**
 * Import des matchs depuis PandaScore.
 *
 * Trois couches, et une seule va-et-vient avec PandaScore :
 * - **le cache** (`pandascore_matches`) garde la reponse telle que recue. Le
 *   staff ne le modifie jamais ; il n'est reecrit que par un appel.
 * - **la semaine** composee reste la seule chose publiee. Un import y copie
 *   des matchs, que le staff corrige ensuite librement.
 * - **rien n'est automatique** : ni appel planifie, ni creation de match, ni
 *   publication. L'appel part quand quelqu'un ouvre l'import d'une semaine
 *   jamais recuperee, ou clique « Actualiser » ; un match n'entre dans la
 *   semaine que coche ; un match deja importe n'est ecrase que s'il est coche
 *   de nouveau, ses differences sous les yeux.
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

	private get token(): string {
		return this.appConfig.get("app", { infer: true }).pandascore.token;
	}

	private async reglages(): Promise<{ leagueIds: number[]; series: string[] }> {
		const row = await this.prisma.esportConfig.findUnique({
			where: { guildId: this.guild.guildId },
			select: { pandascoreLeagueIds: true, pandascoreSeries: true },
		});
		return {
			leagueIds: row?.pandascoreLeagueIds ?? DEFAULT_LEAGUE_IDS,
			series: row?.pandascoreSeries ?? [],
		};
	}

	/** Lundi 06:00 -> lundi suivant 05:59:59, heure de Paris (`ESPORT_DAY_START`). */
	private bornes(weekStart: string): { from: Date; to: Date } {
		const from = zonedWallTimeToUtc(weekStart, ESPORT_DAY_START, ESPORT_TIME_ZONE);
		const lundiSuivant = zonedWallTimeToUtc(addDaysToKey(weekStart, 7), ESPORT_DAY_START, ESPORT_TIME_ZONE);
		return { from, to: new Date(lundiSuivant.getTime() - 1000) };
	}

	private exigerJeton(): void {
		if (!this.token) {
			throw new ServiceUnavailableException(
				"L'import PandaScore n'est pas configuré sur ce serveur (PANDASCORE_TOKEN).",
			);
		}
	}

	private exigerLigues(leagueIds: number[]): void {
		if (!leagueIds.length) {
			throw new BadRequestException(
				"Aucune ligue PandaScore n'est réglée : un administrateur doit en choisir une dans les réglages.",
			);
		}
	}

	// -------------------------------------------------------------------------
	// Cache
	// -------------------------------------------------------------------------

	/**
	 * Matchs PandaScore de la semaine, mis en regard de ceux deja importes.
	 *
	 * Lit le cache ; n'appelle PandaScore que si la semaine n'a jamais ete
	 * recuperee, ou l'a ete pour d'autres ligues que celles reglees aujourd'hui.
	 */
	async weekView(weekId: string): Promise<PandascoreWeekDto> {
		const week = await this.esport.loadWeek(weekId);
		if (!this.token) {
			return { available: false, fetchedAt: null, refreshableAt: null, matches: [], missing: [] };
		}

		const weekStart = toKey(week.weekStart);
		const { leagueIds, series } = await this.reglages();
		this.exigerLigues(leagueIds);

		let appel = await this.prisma.pandascoreFetch.findUnique({ where: { weekStart: week.weekStart } });
		if (!appel || !memesLigues(appel.leagueIds, leagueIds)) {
			await this.actualiser(weekStart, leagueIds);
			appel = await this.prisma.pandascoreFetch.findUnique({ where: { weekStart: week.weekStart } });
		}

		const [caches, locaux] = await Promise.all([
			this.lireCache(weekStart, leagueIds),
			this.prisma.esportMatch.findMany({
				where: { weekId, pandascoreId: { not: null } },
				include: { teamA: true, teamB: true },
			}),
		]);

		const parId = new Map(locaux.map((local) => [local.pandascoreId!, local]));
		const presents = new Set(caches.map((match) => match.id));

		return {
			available: true,
			fetchedAt: appel?.fetchedAt.toISOString() ?? null,
			refreshableAt: appel
				? new Date(appel.fetchedAt.getTime() + PANDASCORE_REFRESH_COOLDOWN_MS).toISOString()
				: null,
			matches: caches.map((match) => {
				const local = parId.get(match.id);
				return {
					...this.toDto(match),
					followed: isFollowed(match, series),
					importedMatchId: local?.id ?? null,
					differences: local ? this.differences(local, match) : [],
				};
			}),
			missing: locaux
				.filter((local) => !presents.has(local.pandascoreId!))
				.map((local) => ({
					matchId: local.id,
					label: `${nomLocal(local.teamA)} vs ${nomLocal(local.teamB)}`,
				})),
		};
	}

	/** « Actualiser » : un appel, refuse s'il en est parti un il y a moins de deux minutes. */
	async refresh(weekId: string): Promise<PandascoreWeekDto> {
		const week = await this.esport.loadWeek(weekId);
		this.exigerJeton();
		const { leagueIds } = await this.reglages();
		this.exigerLigues(leagueIds);

		const appel = await this.prisma.pandascoreFetch.findUnique({ where: { weekStart: week.weekStart } });
		if (appel && memesLigues(appel.leagueIds, leagueIds)) {
			const permis = appel.fetchedAt.getTime() + PANDASCORE_REFRESH_COOLDOWN_MS;
			if (Date.now() < permis) {
				throw new BadRequestException(
					`Les données datent de moins de deux minutes : nouvelle actualisation possible à ${zonedTimeOfDay(
						new Date(permis),
						ESPORT_TIME_ZONE,
					)}.`,
				);
			}
		}

		await this.actualiser(toKey(week.weekStart), leagueIds);
		return this.weekView(weekId);
	}

	private actualiser(weekStart: string, leagueIds: number[]): Promise<void> {
		const enCours = this.enVol.get(weekStart);
		if (enCours) return enCours;

		const promesse = this.appeler(weekStart, leagueIds).finally(() => this.enVol.delete(weekStart));
		this.enVol.set(weekStart, promesse);
		return promesse;
	}

	private async appeler(weekStart: string, leagueIds: number[]): Promise<void> {
		const { from, to } = this.bornes(weekStart);

		let bruts: PandascoreRawMatch[];
		try {
			bruts = await fetchOverwatchMatches({ token: this.token, leagueIds, from, to });
		} catch (err) {
			if (err instanceof PandascoreError) {
				this.logger.warn(`Appel PandaScore échoué (semaine du ${weekStart}) : ${err.message}`);
				// 400 et non 502 : le message s'affiche dans la fenetre d'import,
				// la ou l'on peut reessayer, plutot qu'en notification volante.
				throw new BadRequestException(err.message);
			}
			throw err;
		}

		const lus = bruts.filter((raw) => readPandascoreMatch(raw) !== null);
		const maintenant = new Date();
		const limite = new Date(maintenant.getTime() - CACHE_RETENTION_MS);

		await this.prisma.$transaction(
			async (tx) => {
				for (const raw of lus) {
					const champs = {
						leagueId: raw.league_id,
						scheduledAt: new Date(raw.scheduled_at!),
						status: (raw.status ?? "not_started").slice(0, 20),
						data: raw as unknown as Prisma.InputJsonValue,
						fetchedAt: maintenant,
					};
					await tx.pandascoreMatch.upsert({
						where: { id: raw.id },
						update: champs,
						create: { id: raw.id, ...champs },
					});
				}

				// Absent de la reponse : deplace dans une autre semaine, ou retire.
				// Il reapparaitra dans le cache de sa nouvelle semaine.
				await tx.pandascoreMatch.deleteMany({
					where: {
						leagueId: { in: leagueIds },
						scheduledAt: { gte: from, lte: to },
						id: { notIn: lus.map((raw) => raw.id) },
					},
				});

				await tx.pandascoreFetch.upsert({
					where: { weekStart: fromKey(weekStart) },
					update: { leagueIds, matchCount: lus.length, fetchedAt: maintenant },
					create: { weekStart: fromKey(weekStart), leagueIds, matchCount: lus.length, fetchedAt: maintenant },
				});

				await tx.pandascoreMatch.deleteMany({ where: { scheduledAt: { lt: limite } } });
				await tx.pandascoreFetch.deleteMany({ where: { weekStart: { lt: limite } } });
			},
			{ timeout: 20_000 },
		);
	}

	private async lireCache(weekStart: string, leagueIds: number[]): Promise<PandascoreMatch[]> {
		const { from, to } = this.bornes(weekStart);
		const rows = await this.prisma.pandascoreMatch.findMany({
			where: { leagueId: { in: leagueIds }, scheduledAt: { gte: from, lte: to } },
			orderBy: { scheduledAt: "asc" },
		});
		return rows
			.map((row) => readPandascoreMatch(row.data as unknown as PandascoreRawMatch))
			.filter((match): match is PandascoreMatch => match !== null);
	}

	private toDto(
		match: PandascoreMatch,
	): Omit<PandascoreMatchDto, "followed" | "importedMatchId" | "differences"> {
		return {
			id: match.id,
			scheduledAt: match.scheduledAt.toISOString(),
			rescheduled: match.rescheduled,
			status: match.status,
			competition: match.competition,
			region: match.region,
			serie: match.serie,
			tournament: match.tournament,
			format: match.format,
			games: match.games,
			teamA: match.teamA,
			teamB: match.teamB,
			score: match.finished
				? {
						a: match.scores.get(match.teamA?.id ?? -1) ?? 0,
						b: match.scores.get(match.teamB?.id ?? -1) ?? 0,
					}
				: null,
			forfeit: match.forfeit,
			streamUrl: match.streamUrl,
		};
	}

	/**
	 * Ce qu'un nouvel import changerait. Le score n'y figure pas : il ne passe
	 * jamais par l'import, seulement par « Terminer ».
	 */
	private differences(local: MatchRow, match: PandascoreMatch): string[] {
		const diffs: string[] = [];

		if (local.scheduledAt.getTime() !== match.scheduledAt.getTime()) {
			diffs.push(`Horaire : ${quand(local.scheduledAt)} → ${quand(match.scheduledAt)}`);
		}

		if (
			(local.teamA?.pandascoreId ?? null) !== (match.teamA?.id ?? null) ||
			(local.teamB?.pandascoreId ?? null) !== (match.teamB?.id ?? null)
		) {
			diffs.push(
				`Équipes : ${nomLocal(local.teamA)} vs ${nomLocal(local.teamB)} → ${nomPandascore(
					match.teamA,
				)} vs ${nomPandascore(match.teamB)}`,
			);
		}

		const formatLocal = esportFormatLabel(local.format, local.bestOf) ?? "—";
		const formatPandascore = esportFormatLabel(match.format, match.games) ?? "—";
		if (formatLocal !== formatPandascore) diffs.push(`Format : ${formatLocal} → ${formatPandascore}`);

		if ((local.competition ?? "") !== match.competition) {
			diffs.push(`Compétition : « ${local.competition ?? "—"} » → « ${match.competition} »`);
		}

		if ((local.region ?? null) !== match.region) {
			diffs.push(
				`Région : ${esportRegionLabel(local.region) ?? "aucune"} → ${esportRegionLabel(match.region) ?? "aucune"}`,
			);
		}

		if ((local.streamUrl ?? null) !== match.streamUrl) diffs.push("Lien du stream");

		return diffs;
	}

	// -------------------------------------------------------------------------
	// Import
	// -------------------------------------------------------------------------

	/**
	 * Copie les matchs coches dans la semaine. Lit le **cache**, jamais
	 * PandaScore : ce qui est importe est exactement ce que le staff a vu.
	 *
	 * Un match deja importe est mis a jour (horaire, equipes, format, stream,
	 * competition) ; son score, son spoiler et ses messages ne bougent pas.
	 */
	async import(weekId: string, ids: number[], actor: AuthenticatedUser): Promise<EsportWeekDto> {
		const week = await this.esport.loadWeek(weekId);
		this.exigerJeton();

		const weekStart = toKey(week.weekStart);
		const uniques = [...new Set(ids)];

		const rows = await this.prisma.pandascoreMatch.findMany({ where: { id: { in: uniques } } });
		const lus = new Map<number, PandascoreMatch>();
		for (const row of rows) {
			const match = readPandascoreMatch(row.data as unknown as PandascoreRawMatch);
			if (match) lus.set(row.id, match);
		}

		for (const id of uniques) {
			const match = lus.get(id);
			if (!match) {
				throw new BadRequestException(
					"Un des matchs choisis n'est plus dans les données PandaScore : actualisez la liste.",
				);
			}
			if (esportWeekStart(match.scheduledAt) !== weekStart) {
				throw new BadRequestException(
					`${nomPandascore(match.teamA)} vs ${nomPandascore(match.teamB)} n'est plus prévu cette semaine chez PandaScore : actualisez la liste.`,
				);
			}
		}

		const existants = await this.prisma.esportMatch.findMany({
			where: { weekId, pandascoreId: { in: uniques } },
		});
		const dejaLa = new Map(existants.map((match) => [match.pandascoreId!, match]));

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
						await tx.esportMatch.create({ data: { weekId, pandascoreId: id, ...data } });
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
			after: { pandascoreIds: uniques, created: nouveaux, updated: uniques.length - nouveaux },
		});

		return this.esport.findWeek(weekId);
	}

	/**
	 * Equipe du dashboard correspondant a une equipe PandaScore, creee au besoin.
	 *
	 * Par identifiant PandaScore d'abord ; puis par nom, pour relier une equipe
	 * saisie a la main avant l'import (elle garde son emoji et son logo) ; sinon
	 * creee avec le nom et le logo de PandaScore, que le staff peut modifier.
	 * Une equipe reliee mais archivee est restauree : elle rejoue.
	 */
	private async equipe(tx: Tx, team: PandascoreTeamDto | null): Promise<string | null> {
		if (!team) return null;
		const guildId = this.guild.guildId;

		const liee = await tx.esportTeam.findUnique({
			where: { guildId_pandascoreId: { guildId, pandascoreId: team.id } },
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
				pandascoreId: null,
				name: { equals: team.name, mode: "insensitive" },
			},
		});
		if (homonyme) {
			await tx.esportTeam.update({
				where: { id: homonyme.id },
				data: { pandascoreId: team.id, logoUrl: homonyme.logoUrl ?? team.logoUrl },
			});
			return homonyme.id;
		}

		// Nom deja pris par une autre equipe PandaScore : l'acronyme departage.
		const pris = await tx.esportTeam.findFirst({
			where: { guildId, archivedAt: null, name: { equals: team.name, mode: "insensitive" } },
		});
		const creee = await tx.esportTeam.create({
			data: {
				guildId,
				name: (pris ? `${team.name} (${team.acronym ?? team.id})` : team.name).slice(0, 80),
				logoUrl: team.logoUrl?.slice(0, 500) ?? null,
				pandascoreId: team.id,
			},
		});
		return creee.id;
	}

	// -------------------------------------------------------------------------
	// Score
	// -------------------------------------------------------------------------

	/**
	 * Score PandaScore d'un match importe, dans l'ordre des equipes du
	 * dashboard. Une simple proposition : c'est « Terminer » qui fait foi.
	 */
	async resultSuggestion(matchId: string): Promise<PandascoreResultSuggestionDto> {
		const local = await this.prisma.esportMatch.findFirst({
			where: { id: matchId, week: { guildId: this.guild.guildId } },
			include: { teamA: true, teamB: true },
		});
		if (!local) throw new NotFoundException("Match introuvable.");

		const vide: PandascoreResultSuggestionDto = {
			available: Boolean(this.token),
			fetchedAt: null,
			refreshableAt: null,
			status: null,
			score: null,
			forfeit: false,
		};
		if (!this.token || !local.pandascoreId) return vide;

		const weekStart = esportWeekStart(local.scheduledAt);
		const [row, appel] = await Promise.all([
			this.prisma.pandascoreMatch.findUnique({ where: { id: local.pandascoreId } }),
			this.prisma.pandascoreFetch.findUnique({ where: { weekStart: fromKey(weekStart) } }),
		]);

		const meta = {
			fetchedAt: appel?.fetchedAt.toISOString() ?? null,
			refreshableAt: appel
				? new Date(appel.fetchedAt.getTime() + PANDASCORE_REFRESH_COOLDOWN_MS).toISOString()
				: null,
		};
		const match = row ? readPandascoreMatch(row.data as unknown as PandascoreRawMatch) : null;
		if (!match) return { ...vide, ...meta };

		let score: PandascoreResultSuggestionDto["score"] = null;
		if (match.finished) {
			// Les equipes reliees donnent l'ordre local, meme si le staff les a
			// inversees ; sinon, l'ordre de PandaScore.
			const relies = local.teamA?.pandascoreId != null && local.teamB?.pandascoreId != null;
			const idA = relies ? local.teamA!.pandascoreId! : match.teamA?.id;
			const idB = relies ? local.teamB!.pandascoreId! : match.teamB?.id;
			score = {
				a: idA != null ? (match.scores.get(idA) ?? 0) : 0,
				b: idB != null ? (match.scores.get(idB) ?? 0) : 0,
			};
		}

		return { available: true, ...meta, status: match.status, score, forfeit: match.forfeit };
	}
}
