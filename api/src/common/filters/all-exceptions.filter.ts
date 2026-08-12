import {
	ArgumentsHost,
	Catch,
	ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiErrorBody } from "@anubis/shared";

/**
 * Normalise toutes les erreurs vers un seul format, celui que le dashboard sait
 * afficher. Les erreurs inattendues sont journalisees en detail cote serveur
 * mais renvoyees sans stack trace au client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
	private readonly logger = new Logger(AllExceptionsFilter.name);

	catch(exception: unknown, host: ArgumentsHost): void {
		const ctx = host.switchToHttp();
		const response = ctx.getResponse<Response>();
		const request = ctx.getRequest<Request>();

		const status =
			exception instanceof HttpException
				? exception.getStatus()
				: HttpStatus.INTERNAL_SERVER_ERROR;

		let message = "Erreur interne du serveur.";
		let details: Record<string, string[]> | undefined;

		if (exception instanceof HttpException) {
			const payload = exception.getResponse();

			if (typeof payload === "string") {
				message = payload;
			} else if (typeof payload === "object" && payload !== null) {
				const body = payload as { message?: string | string[] };
				if (Array.isArray(body.message)) {
					// Sortie de ValidationPipe : une liste de messages a plat.
					message = "Donnees invalides.";
					details = { _: body.message };
				} else if (typeof body.message === "string") {
					message = body.message;
				}
			}
		}

		if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
			this.logger.error(
				`${request.method} ${request.url}`,
				exception instanceof Error
					? exception.stack
					: String(exception),
			);
		}

		const body: ApiErrorBody = {
			statusCode: status,
			message,
			details,
			timestamp: new Date().toISOString(),
			path: request.url,
		};

		response.status(status).json(body);
	}
}
