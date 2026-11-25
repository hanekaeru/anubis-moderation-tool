import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { AppConfig } from "../config/configuration";
import { PrismaService } from "../prisma/prisma.service";

const TIMEOUT_MS = 10_000;

/**
 * Signal de vie de l'API vers une supervision exterieure, toutes les cinq
 * minutes. Meme principe que celui du bot (`bot/src/collectors/healthcheck.ts`),
 * avec sa propre adresse : l'alerte dit ainsi lequel des deux est tombe.
 *
 * Le signal n'est envoye que si la base repond — une API qui ne sert que des
 * 503 n'est pas « en vie ». Il ne porte rien d'autre que l'appel lui-meme.
 */
@Injectable()
export class HealthcheckPingService implements OnApplicationBootstrap {
	private readonly logger = new Logger(HealthcheckPingService.name);
	/** Pour ne journaliser qu'au changement d'etat. */
	private dernierEchec: string | null = null;

	constructor(
		private readonly prisma: PrismaService,
		private readonly config: ConfigService<{ app: AppConfig }, true>,
	) {}

	private get url(): string | null {
		const brute = this.config.get("app", { infer: true }).healthcheckUrl;
		if (!brute) return null;
		try {
			const url = new URL(brute);
			return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
		} catch {
			return null;
		}
	}

	/** Un premier signal au demarrage : le retour apres une panne se voit tout de suite. */
	onApplicationBootstrap(): void {
		const brute = this.config.get("app", { infer: true }).healthcheckUrl;
		if (brute && !this.url) {
			this.logger.error("HEALTHCHECK_URL n'est pas une adresse http(s) : aucun signal ne partira.");
			return;
		}
		void this.signaler();
	}

	@Cron(CronExpression.EVERY_5_MINUTES)
	async signaler(): Promise<void> {
		const url = this.url;
		if (!url) return;

		try {
			await this.prisma.$queryRaw`SELECT 1`;
			const reponse = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
			if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
			if (this.dernierEchec) this.logger.log("Signal de vie rétabli.");
			this.dernierEchec = null;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (this.dernierEchec !== message) this.logger.error(`Signal de vie non envoyé : ${message}`);
			this.dernierEchec = message;
		}
	}
}
