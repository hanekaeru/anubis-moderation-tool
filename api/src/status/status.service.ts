import { Injectable } from "@nestjs/common";
import type {
	ApiStatusDto,
	BotStatusDto,
	StatusDto,
	StatusProblemDto,
} from "@anubis/shared";
import { GuildContextService } from "../common/guild-context.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Au-dela de ce delai sans battement, le bot est considere hors ligne. Quatre
 * fois son intervalle d'ecriture (5s) : assez large pour qu'un passage un peu
 * lent ne fasse pas clignoter le statut, assez court pour qu'un arret reel se
 * voie en quelques secondes.
 */
const BOT_OFFLINE_AFTER_MS = 20_000;

/** Latence de passerelle au-dela de laquelle on signale une degradation. */
const HIGH_PING_MS = 250;

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class StatusService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
	) {}

	/** Meme sonde que `HealthController`, mais sans faire echouer la reponse : ici l'indisponibilite est une information a afficher, pas une panne a signaler par un 503. */
	private async checkDatabase(): Promise<ApiStatusDto["database"]> {
		const start = Date.now();

		try {
			await this.prisma.$queryRaw`SELECT 1`;
			return { reachable: true, latencyMs: Date.now() - start };
		} catch {
			return { reachable: false, latencyMs: null };
		}
	}

	private buildProblems(
		bot: BotStatusDto | null,
		api: ApiStatusDto,
		activeRaidLockdown: boolean,
	): StatusProblemDto[] {
		const problems: StatusProblemDto[] = [];

		if (!api.database.reachable) {
			problems.push({
				severity: "critical",
				message: "Base de données injoignable depuis l'API.",
			});
		}

		if (!bot) {
			problems.push({
				severity: "critical",
				message:
					"Le bot n'a jamais signalé son état : il n'a probablement jamais démarré depuis cette base.",
			});
		} else if (!bot.online) {
			problems.push({
				severity: "critical",
				message:
					"Le bot est hors ligne : aucune sanction ni action posée depuis la webapp ne sera appliquée sur Discord.",
			});
		} else if (bot.avgPingMs !== null && bot.avgPingMs > HIGH_PING_MS) {
			problems.push({
				severity: "warning",
				message: `Latence Discord élevée (${bot.avgPingMs} ms en moyenne).`,
			});
		}

		if (activeRaidLockdown) {
			problems.push({
				severity: "warning",
				message:
					"Un confinement anti-raid est actif : les salons concernés restent verrouillés.",
			});
		}

		return problems;
	}

	async getStatus(): Promise<StatusDto> {
		const guildId = this.guild.guildId;
		const now = Date.now();

		const [heartbeat, database, activeLockdown, automodIncidents24h] =
			await Promise.all([
				this.prisma.botHeartbeat.findUnique({ where: { id: "bot" } }),
				this.checkDatabase(),
				this.prisma.raidIncident.findFirst({
					where: { guildId, resolvedAt: null },
					select: { id: true },
				}),
				this.prisma.automodIncident.count({
					where: { guildId, occurredAt: { gte: new Date(now - DAY_MS) } },
				}),
			]);

		let bot: BotStatusDto | null = null;

		if (heartbeat) {
			const online =
				now - heartbeat.lastHeartbeatAt.getTime() < BOT_OFFLINE_AFTER_MS;

			// Hors ligne, l'uptime se fige au dernier battement : le compter
			// jusqu'a maintenant ferait grandir indefiniment la duree de
			// fonctionnement d'un process arrete.
			const upUntil = online ? now : heartbeat.lastHeartbeatAt.getTime();

			bot = {
				online,
				startedAt: heartbeat.startedAt.toISOString(),
				lastHeartbeatAt: heartbeat.lastHeartbeatAt.toISOString(),
				wsPingMs: heartbeat.wsPingMs,
				avgPingMs: heartbeat.avgPingMs,
				guildCount: heartbeat.guildCount,
				uptimeSeconds: Math.max(
					0,
					Math.round((upUntil - heartbeat.startedAt.getTime()) / 1000),
				),
			};
		}

		const api: ApiStatusDto = {
			uptimeSeconds: Math.round(process.uptime()),
			database,
		};

		const activeRaidLockdown = activeLockdown !== null;

		return {
			bot,
			api,
			activeRaidLockdown,
			automodIncidents24h,
			problems: this.buildProblems(bot, api, activeRaidLockdown),
			checkedAt: new Date(now).toISOString(),
		};
	}
}
