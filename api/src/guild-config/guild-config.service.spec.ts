import {
	BadRequestException,
	ConflictException,
	NotFoundException,
} from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types";
import type { GuildContextService } from "../common/guild-context.service";
import type { PrismaService } from "../prisma/prisma.service";
import { GuildConfigService } from "./guild-config.service";

const ACTOR: AuthenticatedUser = {
	id: "app-1",
	username: "admin",
	displayName: "Admin",
	role: "ADMIN",
	permissions: [],
	mustChangePassword: false,
};

function configRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 1n,
		guildId: "guild-1",
		configName: "LOG_CHANNEL_MODERATION",
		configValue: "123456789012345678",
		configDescription: "Salon de logs",
		...overrides,
	};
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
	const prisma = {
		configGuild: {
			findMany: jest.fn(),
			findUnique: jest.fn().mockResolvedValue(null),
			findFirst: jest.fn(),
			create: jest.fn().mockResolvedValue(configRow()),
			update: jest.fn().mockResolvedValue(configRow()),
			delete: jest.fn().mockResolvedValue(undefined),
		},
		...prismaOverrides,
	} as unknown as PrismaService;

	const guild = { guildId: "guild-1" } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return { service: new GuildConfigService(prisma, guild, audit), prisma, audit };
}

describe("GuildConfigService.create", () => {
	it("rejette un configName deja utilise sur ce serveur", async () => {
		const { service } = makeService({
			configGuild: {
				findMany: jest.fn(),
				findUnique: jest.fn().mockResolvedValue(configRow()),
				findFirst: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				delete: jest.fn(),
			},
		});

		await expect(
			service.create(
				{
					configName: "LOG_CHANNEL_MODERATION",
					configValue: "1",
					configDescription: "x",
				},
				ACTOR,
			),
		).rejects.toBeInstanceOf(ConflictException);
	});

	it("cree la configuration quand le nom est libre", async () => {
		const { service, audit } = makeService();

		const result = await service.create(
			{
				configName: "LOG_CHANNEL_MODERATION",
				configValue: "123456789012345678",
				configDescription: "Salon de logs",
			},
			ACTOR,
		);

		expect(result.configName).toBe("LOG_CHANNEL_MODERATION");
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ action: "guildconfig.create" }),
		);
	});
});

describe("GuildConfigService — reglages de mention", () => {
	function makeMentionService(rows: ReturnType<typeof configRow>[]) {
		const configGuild = {
			findMany: jest.fn().mockResolvedValue(rows),
			findUnique: jest.fn(),
			findFirst: jest.fn(),
			create: jest.fn(),
			update: jest.fn(),
			upsert: jest.fn(),
			deleteMany: jest.fn(),
			delete: jest.fn(),
		};

		return makeService({
			configGuild,
			$transaction: jest.fn().mockResolvedValue([]),
		});
	}

	it("rend les defauts quand aucune cle n'est posee", async () => {
		const { service } = makeMentionService([]);

		const settings = await service.getMentionSettings();

		expect(settings.roles.MOD_ROLE).toBeNull();
		expect(settings.alertRoleKey).toBeNull();
		// Les journaux n'interpellent personne tant que rien n'est regle.
		expect(settings.mentionMembers).toBe(false);
	});

	it("ignore une cle de role inconnue posee a la main dans la table", async () => {
		const { service } = makeMentionService([
			configRow({ configName: "ALERT_MENTION_ROLE", configValue: "N_IMPORTE_QUOI" }),
		]);

		expect((await service.getMentionSettings()).alertRoleKey).toBeNull();
	});

	it("refuse un identifiant de role qui n'est pas un snowflake", async () => {
		const { service } = makeMentionService([]);

		await expect(
			service.updateMentionSettings(
				{
					roles: { MOD_ROLE: "@Modération" },
					alertRoleKey: null,
					mentionMembers: false,
				},
				ACTOR,
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("refuse de mentionner un role dont l'identifiant n'est pas renseigne", async () => {
		const { service } = makeMentionService([]);

		await expect(
			service.updateMentionSettings(
				{ roles: {}, alertRoleKey: "MOD_ROLE", mentionMembers: false },
				ACTOR,
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("efface la ligne d'un role vide plutot que d'y laisser une chaine vide", async () => {
		const { service, prisma } = makeMentionService([]);

		await service.updateMentionSettings(
			{ roles: { MOD_ROLE: "   " }, alertRoleKey: null, mentionMembers: true },
			ACTOR,
		);

		expect(prisma.configGuild.deleteMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { guildId: "guild-1", configName: "MOD_ROLE" } }),
		);
		expect(prisma.configGuild.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				create: expect.objectContaining({
					configName: "LOG_MENTION_MEMBERS",
					configValue: "true",
				}),
			}),
		);
	});
});

describe("GuildConfigService — identifiants", () => {
	it("rejette un id non numerique sur update", async () => {
		const { service } = makeService();
		await expect(
			service.update("not-an-id", { configValue: "1" }, ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("rejette un id inconnu sur update", async () => {
		const { service } = makeService({
			configGuild: {
				findMany: jest.fn(),
				findUnique: jest.fn(),
				findFirst: jest.fn().mockResolvedValue(null),
				create: jest.fn(),
				update: jest.fn(),
				delete: jest.fn(),
			},
		});

		await expect(
			service.update("42", { configValue: "1" }, ACTOR),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it("rejette un id inconnu sur remove", async () => {
		const { service } = makeService({
			configGuild: {
				findMany: jest.fn(),
				findUnique: jest.fn(),
				findFirst: jest.fn().mockResolvedValue(null),
				create: jest.fn(),
				update: jest.fn(),
				delete: jest.fn(),
			},
		});

		await expect(service.remove("42", ACTOR)).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});
});
