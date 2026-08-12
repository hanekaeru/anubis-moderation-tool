import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import type { AppConfig } from "./config/configuration";

/**
 * PostgreSQL renvoie les BIGINT en BigInt, que JSON.stringify refuse de
 * serialiser. Les mappers convertissent explicitement, mais ce filet evite
 * qu'un oubli ne fasse tomber une reponse en production.
 */
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
	return this.toString();
};

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create(AppModule, { bufferLogs: true });
	const config = app.get(ConfigService<{ app: AppConfig }, true>);
	const appConfig = config.get("app", { infer: true });

	// Vide en production : Traefik route `/api/*` vers ce conteneur en retirant
	// le prefixe au passage. Le remettre ici le ferait attendre `/api/api/...`
	// et renverrait 404 sur toutes les routes.
	if (appConfig.globalPrefix) {
		app.setGlobalPrefix(appConfig.globalPrefix);
	}
	app.use(cookieParser());
	app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

	app.enableCors({
		origin: appConfig.corsOrigins,
		// Indispensable : le refresh token voyage en cookie.
		credentials: true,
	});

	app.useGlobalPipes(
		new ValidationPipe({
			transform: true,
			whitelist: true,
			// Un champ inconnu est une erreur, pas quelque chose a ignorer
			// silencieusement : c'est le plus souvent une faute de frappe cote client.
			forbidNonWhitelisted: true,
			transformOptions: { enableImplicitConversion: false },
		}),
	);

	app.useGlobalFilters(new AllExceptionsFilter());
	app.enableShutdownHooks();

	await app.listen(appConfig.port);

	const logger = new Logger("Bootstrap");
	logger.log(
		`API demarree sur http://localhost:${appConfig.port}/${appConfig.globalPrefix}` +
			(appConfig.globalPrefix
				? ""
				: " (aucun prefixe : il est retire par le proxy)"),
	);
	logger.log(`Serveur Discord administre : ${appConfig.guildId}`);
}

void bootstrap();
