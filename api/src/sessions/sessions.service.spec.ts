import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import type { TokenService } from "../auth/token.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { SessionsService } from "./sessions.service";

function token(overrides: Record<string, unknown> = {}) {
	return {
		id: "token-1",
		appUserId: "user-1",
		familyId: "family-1",
		issuedAt: new Date("2026-08-01T10:00:00.000Z"),
		expiresAt: new Date("2026-08-08T10:00:00.000Z"),
		revokedAt: null,
		userAgent: "Firefox",
		ip: "10.0.0.1",
		appUser: {
			id: "user-1",
			username: "hanekaeru",
			displayName: "Haneka",
			role: "OWNER" as const,
		},
		...overrides,
	};
}

const actor: AuthenticatedUser = {
	id: "owner-1",
	username: "owner",
	displayName: "Owner",
	role: "OWNER",
	permissions: [],
	mustChangePassword: false,
	sessionId: "family-courante",
};

function makeService(rows: ReturnType<typeof token>[] = []) {
	const findMany = jest.fn().mockResolvedValue(rows);
	const updateMany = jest.fn().mockResolvedValue({ count: 3 });
	const findFirst = jest.fn().mockResolvedValue({ appUserId: "user-1" });

	const prisma = {
		refreshToken: { findMany, findFirst, updateMany },
	} as unknown as PrismaService;

	const tokens = {
		revokeFamily: jest.fn().mockResolvedValue(2),
	} as unknown as TokenService;

	const audit = {
		record: jest.fn().mockResolvedValue(undefined),
	} as unknown as AuditService;

	return {
		service: new SessionsService(prisma, tokens, audit),
		findMany,
		findFirst,
		updateMany,
		tokens,
		audit,
	};
}

describe("SessionsService.list", () => {
	// Une famille est une session : la rotation cree un jeton par
	// rafraichissement, et les afficher un par un noierait la page.
	it("regroupe les rotations d'une meme famille en une seule ligne", async () => {
		const { service } = makeService([
			token({ id: "t1", issuedAt: new Date("2026-08-01T10:00:00.000Z") }),
			token({
				id: "t2",
				issuedAt: new Date("2026-08-01T11:00:00.000Z"),
				userAgent: "Firefox 142",
			}),
			token({ id: "t3", familyId: "family-2", appUserId: "user-2" }),
		]);

		const sessions = await service.list({}, actor);

		expect(sessions).toHaveLength(2);

		const grouped = sessions.find((s) => s.familyId === "family-1")!;
		expect(grouped.rotationCount).toBe(2);
		expect(grouped.startedAt).toBe("2026-08-01T10:00:00.000Z");
		expect(grouped.lastSeenAt).toBe("2026-08-01T11:00:00.000Z");
		// Le navigateur affiche est celui de la derniere rotation, pas de la
		// premiere : c'est le seul dont on sache qu'il est encore en service.
		expect(grouped.userAgent).toBe("Firefox 142");
	});

	it("ne retient que les jetons vivants sauf demande contraire", async () => {
		const { service, findMany } = makeService();

		await service.list({}, actor);
		expect(findMany.mock.calls[0]![0].where).toMatchObject({
			revokedAt: null,
			expiresAt: { gt: expect.any(Date) },
		});

		await service.list({ includeInactive: true }, actor);
		expect(findMany.mock.calls[1]![0].where.revokedAt).toBeUndefined();
	});

	it("marque la session de l'appelant", async () => {
		const { service } = makeService([
			token({ familyId: "family-courante" }),
			token({ familyId: "family-1" }),
		]);

		const sessions = await service.list({}, actor);

		expect(sessions.find((s) => s.familyId === "family-courante")!.current).toBe(true);
		expect(sessions.find((s) => s.familyId === "family-1")!.current).toBe(false);
	});
});

describe("SessionsService.revoke", () => {
	it("refuse de couper la session de l'appelant", async () => {
		const { service, tokens } = makeService();

		await expect(service.revoke("family-courante", actor)).rejects.toBeInstanceOf(
			ForbiddenException,
		);
		expect(tokens.revokeFamily).not.toHaveBeenCalled();
	});

	it("refuse une famille inconnue", async () => {
		const { service, findFirst } = makeService();
		findFirst.mockResolvedValue(null);

		await expect(service.revoke("family-1", actor)).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it("revoque la famille et journalise", async () => {
		const { service, tokens, audit } = makeService();

		const result = await service.revoke("family-1", actor);

		expect(tokens.revokeFamily).toHaveBeenCalledWith("family-1");
		expect(result.revoked).toBe(2);
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ action: "session.revoke", entityId: "user-1" }),
		);
	});
});

describe("SessionsService.revokeAllForUser", () => {
	// Le proprietaire peut couper ses propres autres sessions ; celle depuis
	// laquelle il agit doit survivre, sinon la page se ferme sous ses pieds.
	it("epargne la session de l'appelant", async () => {
		const { service, updateMany } = makeService();

		const result = await service.revokeAllForUser("user-1", actor);

		expect(updateMany).toHaveBeenCalledWith({
			where: {
				appUserId: "user-1",
				revokedAt: null,
				familyId: { not: "family-courante" },
			},
			data: { revokedAt: expect.any(Date) },
		});
		expect(result.revoked).toBe(3);
	});
});
