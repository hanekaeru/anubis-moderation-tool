import { NotFoundException } from "@nestjs/common";
import { Permission } from "@anubis/shared";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { BattlenetLinksService } from "./battlenet-links.service";

// Les regles de deliaison sont testees avec la fonction partagee
// (`packages/shared/src/server/battlenet.spec.ts`) : ici, seulement ce que le
// service y ajoute — le DTO, le refus en 404 et le journal d'audit.

const GUILD_ID = "1534550360180396132";
const USER_ID = "136122497891303425";

const admin = {
	id: "00000000-0000-0000-0000-000000000001",
	permissions: [Permission.BATTLENET_READ, Permission.BATTLENET_WRITE],
} as unknown as AuthenticatedUser;

function lien(overrides: Record<string, unknown> = {}) {
	return {
		battlenetHash: "a".repeat(64),
		userId: USER_ID,
		battletag: "Hane#2185",
		guildId: GUILD_ID,
		verifiedAt: new Date("2026-11-01T10:00:00Z"),
		unlinkedAt: null,
		unlinkedBy: null,
		unlinkedByDiscord: null,
		...overrides,
	};
}

function makeService(lignes: Record<string, unknown>[] = [lien()]) {
	const prisma = {
		battlenetAccount: {
			findMany: jest.fn().mockResolvedValue(lignes),
			update: jest.fn().mockResolvedValue({}),
			deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
		},
		quarantineConfig: { findUnique: jest.fn().mockResolvedValue(null) },
		quarantineStatus: { findUnique: jest.fn().mockResolvedValue(null) },
	} as unknown as PrismaService;

	const guild = { guildId: GUILD_ID } as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return { service: new BattlenetLinksService(prisma, guild, audit), prisma, audit };
}

describe("BattlenetLinksService.get", () => {
	it("cache le BattleTag sans la permission de lecture", async () => {
		const { service } = makeService();
		const moderateur = { ...admin, permissions: [] } as unknown as AuthenticatedUser;

		const dto = await service.get(USER_ID, moderateur);
		expect(dto.state).toBe("LINKED");
		expect(dto.battletag).toBeNull();
	});

	it("presente une trace comme un compte delie, avec son auteur", async () => {
		const { service } = makeService([
			lien({
				unlinkedAt: new Date(),
				battletag: null,
				unlinkedByDiscord: { id: USER_ID, username: "hane", globalName: "Hane", avatarUrl: null },
			}),
		]);

		const dto = await service.get(USER_ID, admin);
		expect(dto.state).toBe("UNLINKED");
		expect(dto.unlinkedBy).toBe("Hane (Discord)");
	});
});

describe("BattlenetLinksService.unlink", () => {
	it("journalise la deliaison avec son auteur", async () => {
		const { service, audit } = makeService();
		await service.unlink(USER_ID, false, admin);

		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ appUserId: admin.id, action: "battlenet.unlink" }),
		);
	});

	it("repond 404 quand il n'y a rien a delier", async () => {
		const { service, audit } = makeService([lien({ unlinkedAt: new Date() })]);

		await expect(service.unlink(USER_ID, false, admin)).rejects.toBeInstanceOf(
			NotFoundException,
		);
		expect(audit.record).not.toHaveBeenCalled();
	});
});
