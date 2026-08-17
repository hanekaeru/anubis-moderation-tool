import {
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from "@nestjs/common";
import { PrismaClient } from "@anubis/shared/prisma";

/**
 * Client Prisma partage. Une seule instance pour toute l'application : ouvrir
 * un pool par module epuiserait les connexions PostgreSQL.
 */
@Injectable()
export class PrismaService
	extends PrismaClient
	implements OnModuleInit, OnModuleDestroy
{
	private readonly logger = new Logger(PrismaService.name);

	constructor() {
		super({
			log:
				process.env.NODE_ENV === "development"
					? [{ emit: "event", level: "query" }, "warn", "error"]
					: ["warn", "error"],
		});
	}

	async onModuleInit(): Promise<void> {
		await this.$connect();
		this.logger.log("Connexion PostgreSQL établie.");
	}

	async onModuleDestroy(): Promise<void> {
		await this.$disconnect();
	}
}
