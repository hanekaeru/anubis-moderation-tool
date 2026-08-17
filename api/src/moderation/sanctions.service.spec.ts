import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import type { ModerationPointsService } from "./moderation-points.service";
import type {
	CreateSanctionDto,
	RevokeDto,
	SanctionQueryDto,
} from "./dto/moderation.dto";
import { SanctionsService } from "./sanctions.service";

const ACTOR: AuthenticatedUser = {
	id: "app-1",
	username: "mod",
	displayName: "Mod",
	role: "MODERATOR",
	permissions: [],
	mustChangePassword: false,
};

const SANCTION_ROW = {
	id: "sanction-1",
	guildId: "guild-1",
	userId: "250902879667879937",
	type: "TIMEOUT",
	status: "ACTIVE",
	reason: "Spam",
	durationSeconds: 3600,
	startsAt: new Date("2026-01-01T00:00:00.000Z"),
	expiresAt: new Date("2026-01-01T01:00:00.000Z"),
	revokedAt: null,
	revokedBy: null,
	revokedByDiscord: null,
	revokeReason: null,
	automodIncident: null,
	warningId: null,
	evidenceUrl: null,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	attachments: [],
	user: { id: "250902879667879937", username: "member", globalName: null, avatarUrl: null },
	moderator: null,
	createdBy: { id: "app-1", displayName: "Mod" },
};

function makeService(prismaOverrides: Record<string, unknown> = {}) {
	const prisma = {
		sanction: {
			findMany: jest.fn(),
			count: jest.fn(),
			findFirst: jest.fn(),
			create: jest.fn().mockResolvedValue(SANCTION_ROW),
			update: jest.fn().mockResolvedValue({ ...SANCTION_ROW, status: "REVOKED" }),
			updateMany: jest.fn(),
		},
		member: { findUnique: jest.fn().mockResolvedValue({ userId: "member-1" }) },
		warning: { findFirst: jest.fn() },
		moderationActivity: { create: jest.fn().mockResolvedValue(undefined) },
		...prismaOverrides,
	} as unknown as PrismaService;

	const guild = { guildId: "guild-1" } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	// Bareme fige : les tests portent sur la logique de sanction, pas sur la
	// lecture du bareme, qui a ses propres tests.
	const points = {
		pointsForSanction: jest.fn().mockResolvedValue(3),
	} as unknown as ModerationPointsService;

	return {
		service: new SanctionsService(prisma, guild, audit, points),
		prisma,
		audit,
		points,
	};
}

function createDto(overrides: Partial<CreateSanctionDto> = {}): CreateSanctionDto {
	return {
		userId: "250902879667879937",
		type: "TIMEOUT",
		reason: "Spam repete",
		...overrides,
	} as CreateSanctionDto;
}

describe("SanctionsService.create", () => {
	it("rejette une duree sur un type de sanction instantane", async () => {
		const { service } = makeService();
		await expect(
			service.create(createDto({ type: "KICK", durationSeconds: 3600 }), ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("rejette un TIMEOUT sans duree", async () => {
		const { service } = makeService();
		await expect(
			service.create(createDto({ type: "TIMEOUT", durationSeconds: undefined }), ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("rejette un TIMEOUT au-dela de la limite Discord (28 jours)", async () => {
		const { service } = makeService();
		await expect(
			service.create(
				createDto({ type: "TIMEOUT", durationSeconds: 29 * 24 * 60 * 60 }),
				ACTOR,
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("rejette un membre inconnu sur ce serveur", async () => {
		const { service } = makeService({
			member: { findUnique: jest.fn().mockResolvedValue(null) },
		});
		await expect(
			service.create(createDto({ durationSeconds: 3600 }), ACTOR),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it("rejette un warningId qui n'existe pas ou ne concerne pas ce membre", async () => {
		const { service } = makeService({
			warning: { findFirst: jest.fn().mockResolvedValue(null) },
		});
		await expect(
			service.create(
				createDto({ durationSeconds: 3600, warningId: "warning-1" }),
				ACTOR,
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("cree une sanction instantanee directement EXPIRED", async () => {
		const create = jest.fn().mockResolvedValue(SANCTION_ROW);
		const { service } = makeService({
			sanction: {
				create,
				findFirst: jest.fn(),
				findMany: jest.fn(),
				count: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});

		await service.create(createDto({ type: "KICK" }), ACTOR);

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ status: "EXPIRED", durationSeconds: null }),
			}),
		);
	});

	it("cree une sanction a duree ACTIVE avec expiresAt calcule", async () => {
		const create = jest.fn().mockResolvedValue(SANCTION_ROW);
		const { service } = makeService({
			sanction: {
				create,
				findFirst: jest.fn(),
				findMany: jest.fn(),
				count: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});

		await service.create(createDto({ type: "TIMEOUT", durationSeconds: 3600 }), ACTOR);

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: "ACTIVE",
					durationSeconds: 3600,
					expiresAt: expect.any(Date),
				}),
			}),
		);
	});
});

describe("SanctionsService.revoke", () => {
	function revokeDto(): RevokeDto {
		return { reason: "Erreur de moderation" } as RevokeDto;
	}

	it("rejette une sanction introuvable", async () => {
		const { service } = makeService({
			sanction: {
				findFirst: jest.fn().mockResolvedValue(null),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});
		await expect(
			service.revoke("sanction-1", revokeDto(), ACTOR),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it("rejette une sanction deja levee", async () => {
		const { service } = makeService({
			sanction: {
				findFirst: jest.fn().mockResolvedValue({ ...SANCTION_ROW, status: "REVOKED" }),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});
		await expect(
			service.revoke("sanction-1", revokeDto(), ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("rejette une sanction deja terminee (EXPIRED)", async () => {
		const { service } = makeService({
			sanction: {
				findFirst: jest.fn().mockResolvedValue({ ...SANCTION_ROW, status: "EXPIRED" }),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});
		await expect(
			service.revoke("sanction-1", revokeDto(), ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("leve une sanction active et ecrit l'audit", async () => {
		const update = jest.fn().mockResolvedValue({ ...SANCTION_ROW, status: "REVOKED" });
		const { service, audit } = makeService({
			sanction: {
				findFirst: jest.fn().mockResolvedValue(SANCTION_ROW),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update,
				updateMany: jest.fn(),
			},
		});

		await service.revoke("sanction-1", revokeDto(), ACTOR);

		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "sanction-1" },
				data: expect.objectContaining({ status: "REVOKED", revokedById: "app-1" }),
			}),
		);
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ action: "sanction.revoke" }),
		);
	});

	it("remet discordSyncedAt a null pour que le bot rejoue la levee", async () => {
		// Une sanction posee par `/mute` ou ingeree du journal d'audit Discord
		// porte deja une date de synchronisation. Sans cette remise a zero, la
		// levee n'entrait jamais dans `findUnsyncedRevokedSanctions` : le timeout
		// restait en place sur Discord alors que la webapp l'affichait comme levee.
		const update = jest.fn().mockResolvedValue({ ...SANCTION_ROW, status: "REVOKED" });
		const { service } = makeService({
			sanction: {
				findFirst: jest.fn().mockResolvedValue({
					...SANCTION_ROW,
					discordSyncedAt: new Date("2026-08-15T10:00:00.000Z"),
				}),
				findMany: jest.fn(),
				count: jest.fn(),
				create: jest.fn(),
				update,
				updateMany: jest.fn(),
			},
		});

		await service.revoke("sanction-1", revokeDto(), ACTOR);

		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ discordSyncedAt: null }),
			}),
		);
	});
});

describe("SanctionsService.search", () => {
	function searchQuery(overrides: Record<string, unknown> = {}) {
		return {
			page: 1,
			pageSize: 25,
			skip: 0,
			take: 25,
			...overrides,
		} as unknown as SanctionQueryDto;
	}

	function searchService(row: Record<string, unknown>) {
		return makeService({
			sanction: {
				findMany: jest.fn().mockResolvedValue([row]),
				count: jest.fn().mockResolvedValue(1),
				findFirst: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});
	}

	it("annonce l'auteur d'une levee faite depuis Discord", async () => {
		// `revokedById` pointe vers un compte dashboard : une levee posee par
		// `/unban` n'en a pas. Sans `revokedByDiscord`, la sanction s'affichait
		// « Levée » sans le moindre auteur — le cas le plus courant, puisque la
		// plupart des levees se font depuis Discord.
		const { service } = searchService({
			...SANCTION_ROW,
			status: "REVOKED",
			revokedAt: new Date("2026-01-02T00:00:00.000Z"),
			revokeReason: "Erreur de moderation",
			revokedBy: null,
			revokedByDiscord: {
				id: "250902879667879937",
				username: "moderateur",
				globalName: "Modérateur",
			},
		});

		const page = await service.search(searchQuery());

		expect(page.items[0]!.revokedBy).toEqual({
			kind: "discord",
			id: "250902879667879937",
			label: "Modérateur",
		});
		expect(page.items[0]!.revokeReason).toBe("Erreur de moderation");
	});

	it("expose le message supprime d'une sanction automatique", async () => {
		// Le message est supprime de Discord des le declenchement : l'incident
		// en est la seule trace, et sans lui la sanction ne dit que la regle.
		const { service } = searchService({
			...SANCTION_ROW,
			automodIncident: {
				id: 42n,
				ruleType: "WORD_FILTER",
				messageContent: "message interdit",
				channelId: "111",
				details: { matched: "interdit", via: "mot" },
				occurredAt: new Date("2026-01-01T00:00:00.000Z"),
			},
		});

		const page = await service.search(searchQuery());

		expect(page.items[0]!.automod).toEqual({
			// L'identifiant est un BIGINT en base : rendu en chaine, comme
			// partout ailleurs dans les mappers.
			incidentId: "42",
			ruleType: "WORD_FILTER",
			messageContent: "message interdit",
			matched: "interdit",
			channelId: "111",
			occurredAt: "2026-01-01T00:00:00.000Z",
		});
	});

	it("ignore un `details` sans clef `matched` exploitable", async () => {
		const { service } = searchService({
			...SANCTION_ROW,
			automodIncident: {
				id: 7n,
				ruleType: "SPAM_RATE",
				messageContent: null,
				channelId: null,
				details: { count: 12, windowSeconds: 10 },
				occurredAt: new Date("2026-01-01T00:00:00.000Z"),
			},
		});

		const page = await service.search(searchQuery());

		expect(page.items[0]!.automod?.matched).toBeNull();
	});

	it("cherche le membre sur le pseudo, le nom affiche et l'identifiant", async () => {
		const findMany = jest.fn().mockResolvedValue([]);
		const { service } = makeService({
			sanction: {
				findMany,
				count: jest.fn().mockResolvedValue(0),
				findFirst: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});

		await service.search(searchQuery({ member: " Alice " }));

		expect(findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					// Saisie rognee : un espace colle par erreur ne doit pas
					// vider la liste.
					user: {
						OR: [
							{ username: { contains: "Alice", mode: "insensitive" } },
							{ globalName: { contains: "Alice", mode: "insensitive" } },
							{ id: { contains: "Alice" } },
						],
					},
				}),
			}),
		);
	});

	it("ne filtre pas sur un champ de recherche laisse vide", async () => {
		const findMany = jest.fn().mockResolvedValue([]);
		const { service } = makeService({
			sanction: {
				findMany,
				count: jest.fn().mockResolvedValue(0),
				findFirst: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
			},
		});

		await service.search(searchQuery({ member: "   " }));

		expect(findMany.mock.calls[0]![0].where).not.toHaveProperty("user");
	});
});
