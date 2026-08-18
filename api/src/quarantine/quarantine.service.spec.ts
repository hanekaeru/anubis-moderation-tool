import { NotFoundException } from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { QuarantineService } from "./quarantine.service";

// const GUILD_ID = "1534867404755177634";
const GUILD_ID = "1534550360180396132";
const USER_ID = "136122497891303425";

const ACTOR = {
	id: "00000000-0000-0000-0000-000000000001",
	displayName: "Moderatrice",
} as unknown as AuthenticatedUser;

function statusRow(overrides: Record<string, unknown> = {}) {
	return {
		guildId: GUILD_ID,
		userId: USER_ID,
		quarantinedAt: new Date("2026-08-15T10:00:00.000Z"),
		acceptedAt: null,
		discordSyncedAt: new Date("2026-08-15T10:00:00.000Z"),
		user: { username: "hane", globalName: "Hane", avatarUrl: null },
		releasedBy: null,
		...overrides,
	};
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
	const prisma = {
		quarantineConfig: {
			findUnique: jest.fn().mockResolvedValue(null),
			upsert: jest.fn(),
		},
		quarantineStatus: {
			findMany: jest.fn().mockResolvedValue([]),
			findUnique: jest.fn().mockResolvedValue(null),
			update: jest.fn(),
		},
		...prismaOverrides,
	} as unknown as PrismaService;

	const guild = { guildId: GUILD_ID } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return { service: new QuarantineService(prisma, guild, audit), prisma, audit };
}

describe("QuarantineService.getConfig", () => {
	it("renvoie une configuration par defaut quand rien n'est enregistre", async () => {
		const { service } = makeService();
		const config = await service.getConfig();

		expect(config.guildId).toBe(GUILD_ID);
		expect(config.enabled).toBe(false);
		expect(config.roleId).toBeNull();
		expect(config.buttonLabel).toBe("J'accepte le reglement");
	});

	// Le bot itere sur ces listes a chaque levee : un `undefined` la ferait
	// echouer sur un serveur qui n'a jamais ouvert la page.
	it("renvoie des listes de roles vides, jamais indefinies", async () => {
		const { service } = makeService();
		const config = await service.getConfig();

		expect(config.releaseAddRoleIds).toEqual([]);
		expect(config.releaseRemoveRoleIds).toEqual([]);
	});
});

describe("QuarantineService.updateConfig", () => {
	// Listes remplacees en bloc : `[]` doit vider le reglage, et non etre
	// confondu avec « champ absent, ne touche a rien ».
	it("ecrit une liste vide quand le champ est fourni vide", async () => {
		const { service, prisma } = makeService({
			quarantineConfig: {
				findUnique: jest.fn().mockResolvedValue(null),
				upsert: jest.fn().mockResolvedValue({
					guildId: GUILD_ID,
					enabled: true,
					roleId: null,
					channelId: null,
					message: null,
					buttonLabel: "J'accepte le reglement",
					releaseAddRoleIds: [],
					releaseRemoveRoleIds: [],
					updatedAt: new Date("2026-08-18T10:00:00.000Z"),
				}),
			},
		});

		await service.updateConfig({ releaseAddRoleIds: [] }, ACTOR);

		const { update } = (prisma.quarantineConfig.upsert as jest.Mock).mock
			.calls[0]![0];
		expect(update.releaseAddRoleIds).toEqual([]);
		expect(update).not.toHaveProperty("releaseRemoveRoleIds");
	});

	it("laisse intactes les listes absentes de la requete", async () => {
		const { service, prisma } = makeService({
			quarantineConfig: {
				findUnique: jest.fn().mockResolvedValue(null),
				upsert: jest.fn().mockResolvedValue({
					guildId: GUILD_ID,
					enabled: true,
					roleId: null,
					channelId: null,
					message: null,
					buttonLabel: "J'accepte le reglement",
					releaseAddRoleIds: ["136122497891303425"],
					releaseRemoveRoleIds: [],
					updatedAt: new Date("2026-08-18T10:00:00.000Z"),
				}),
			},
		});

		const saved = await service.updateConfig({ enabled: true }, ACTOR);

		const { update } = (prisma.quarantineConfig.upsert as jest.Mock).mock
			.calls[0]![0];
		expect(update).not.toHaveProperty("releaseAddRoleIds");
		expect(saved.releaseAddRoleIds).toEqual(["136122497891303425"]);
	});
});

describe("QuarantineService.release", () => {
	it("refuse un membre jamais mis en quarantaine", async () => {
		const { service } = makeService();

		await expect(service.release(USER_ID, ACTOR)).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it("laisse au bot le retrait du role en remettant discordSyncedAt a null", async () => {
		const prisma = {
			quarantineStatus: {
				findUnique: jest.fn().mockResolvedValue(statusRow()),
				update: jest.fn().mockResolvedValue(
					statusRow({
						acceptedAt: new Date(),
						discordSyncedAt: null,
						releasedBy: { displayName: "Moderatrice" },
					}),
				),
				findMany: jest.fn().mockResolvedValue([]),
			},
		};
		const { service } = makeService(prisma);

		const dto = await service.release(USER_ID, ACTOR);

		expect(prisma.quarantineStatus.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					releasedById: ACTOR.id,
					discordSyncedAt: null,
				}),
			}),
		);
		expect(dto.active).toBe(false);
		expect(dto.pendingSync).toBe(true);
		expect(dto.releasedBy).toBe("Moderatrice");
	});

	it("est idempotent : une quarantaine deja levee n'est pas rejouee", async () => {
		const prisma = {
			quarantineStatus: {
				findUnique: jest.fn().mockResolvedValue(
					statusRow({
						acceptedAt: new Date("2026-08-15T11:00:00.000Z"),
						discordSyncedAt: new Date("2026-08-15T11:00:05.000Z"),
					}),
				),
				update: jest.fn(),
				findMany: jest.fn().mockResolvedValue([]),
			},
		};
		const { service, audit } = makeService(prisma);

		const dto = await service.release(USER_ID, ACTOR);

		expect(prisma.quarantineStatus.update).not.toHaveBeenCalled();
		expect(audit.record).not.toHaveBeenCalled();
		expect(dto.active).toBe(false);
		expect(dto.pendingSync).toBe(false);
	});
});

describe("QuarantineService.listActive", () => {
	it("ne remonte que les membres n'ayant pas accepte, le plus ancien d'abord", async () => {
		const prisma = {
			quarantineStatus: {
				findMany: jest.fn().mockResolvedValue([statusRow()]),
				findUnique: jest.fn(),
				update: jest.fn(),
			},
		};
		const { service } = makeService(prisma);

		const rows = await service.listActive();

		expect(prisma.quarantineStatus.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { guildId: GUILD_ID, acceptedAt: null },
				orderBy: { quarantinedAt: "asc" },
			}),
		);
		expect(rows[0]).toMatchObject({ userId: USER_ID, active: true, username: "hane" });
	});
});
