import { Logger } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "./audit.service";

function makeService(create: jest.Mock) {
	const prisma = { auditLog: { create } } as unknown as PrismaService;
	return new AuditService(prisma);
}

describe("AuditService.record", () => {
	it("ecrit une ligne d'audit avec les valeurs par defaut pour les champs absents", async () => {
		const create = jest.fn().mockResolvedValue(undefined);
		const service = makeService(create);

		await service.record({ action: "auth.login" });

		expect(create).toHaveBeenCalledWith({
			data: {
				appUserId: null,
				action: "auth.login",
				entityType: null,
				entityId: null,
				before: undefined,
				after: undefined,
				ip: null,
				userAgent: null,
			},
		});
	});

	it("tronque le user-agent a 255 caracteres", async () => {
		const create = jest.fn().mockResolvedValue(undefined);
		const service = makeService(create);
		const longUserAgent = "x".repeat(300);

		await service.record({ action: "auth.login", userAgent: longUserAgent });

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ userAgent: "x".repeat(255) }),
			}),
		);
	});

	it("n'echoue jamais quand l'ecriture en base echoue", async () => {
		const loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
		const create = jest.fn().mockRejectedValue(new Error("DB down"));
		const service = makeService(create);

		await expect(service.record({ action: "auth.login" })).resolves.toBeUndefined();

		loggerError.mockRestore();
	});
});
