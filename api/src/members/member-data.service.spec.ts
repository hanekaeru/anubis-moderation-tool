import { BadRequestException } from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { ERASED_USERNAME, MemberDataService } from "./member-data.service";

const USER_ID = "250902879667879937";
const ACTOR = { id: "app-1", permissions: [] } as unknown as AuthenticatedUser;

/** Toutes les tables effacees par `deleteMany`, chacune rendant `count: 1`. */
const TABLES = [
	"warning",
	"sanction",
	"memberNote",
	"ticket",
	"automodIncident",
	"accountFlag",
	"quarantineStatus",
	"identityEvent",
	"memberRole",
	"memberRoleEvent",
	"memberRoleRequest",
	"shadowbanRoleBackup",
	"battlenetVerificationState",
	"messageStat",
	"memberActivityProfile",
	"voiceSession",
	"userLevel",
	"xpAdjustment",
	"giveawayEntry",
	"staffReminder",
	"ticketModeratorPrefix",
	"owdleGame",
	"owdleWeeklyBonus",
	"minigameGame",
	"member",
];

function makeService(options: { bans?: { id: string; automodIncidentId: bigint | null }[]; battlenet?: number } = {}) {
	const prisma: Record<string, any> = {
		discordUser: {
			findUnique: jest.fn().mockResolvedValue({ id: USER_ID }),
			update: jest.fn(),
			delete: jest.fn(),
		},
		battlenetAccount: { updateMany: jest.fn().mockResolvedValue({ count: options.battlenet ?? 0 }) },
		moderationActivity: { updateMany: jest.fn() },
	};
	for (const table of TABLES) prisma[table] = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
	prisma.sanction.findMany = jest.fn().mockResolvedValue(options.bans ?? []);
	prisma.member.updateMany = jest.fn();
	prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));

	const audit = { record: jest.fn() };
	const service = new MemberDataService(prisma as unknown as PrismaService, audit as unknown as AuditService);
	return { service, prisma, audit };
}

describe("MemberDataService.erase", () => {
	it("exige l'identifiant retape", async () => {
		const { service, prisma } = makeService();
		await expect(service.erase(USER_ID, "oui", ACTOR)).rejects.toBeInstanceOf(BadRequestException);
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("supprime tout, compte compris, quand rien n'est a garder", async () => {
		const { service, prisma, audit } = makeService();

		const result = await service.erase(USER_ID, ` ${USER_ID} `, ACTOR);

		expect(result.userRemoved).toBe(true);
		expect(prisma.discordUser.delete).toHaveBeenCalledWith({ where: { id: USER_ID } });
		expect(prisma.discordUser.update).not.toHaveBeenCalled();
		// Les sanctions autres que les bannissements partent.
		expect(prisma.sanction.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID, type: { not: "BAN" } } });
		expect(prisma.moderationActivity.updateMany).toHaveBeenCalledWith({
			where: { targetUserId: USER_ID },
			data: { targetUserId: null },
		});
		// Le journal d'audit ne garde que des compteurs.
		const audite = audit.record.mock.calls[0][0];
		expect(audite.action).toBe("member.data.erase");
		expect(Object.values(audite.after).every((v) => typeof v === "number")).toBe(true);
	});

	it("garde les bannissements et leur incident, et anonymise le compte", async () => {
		const { service, prisma } = makeService({ bans: [{ id: "ban-1", automodIncidentId: 42n }] });

		const result = await service.erase(USER_ID, USER_ID, ACTOR);

		expect(result).toEqual(expect.objectContaining({ userRemoved: false, kept: { bans: 1, battlenetLinks: 0 } }));
		expect(prisma.automodIncident.deleteMany).toHaveBeenCalledWith({
			where: { userId: USER_ID, id: { notIn: [42n] } },
		});
		// Le banni garde sa ligne de presence, sans surnom.
		expect(prisma.member.deleteMany).not.toHaveBeenCalled();
		expect(prisma.member.updateMany).toHaveBeenCalledWith({ where: { userId: USER_ID }, data: { nickname: null } });
		expect(prisma.discordUser.update).toHaveBeenCalledWith({
			where: { id: USER_ID },
			data: { username: ERASED_USERNAME, globalName: null, discriminator: null, avatarUrl: null },
		});
		expect(prisma.discordUser.delete).not.toHaveBeenCalled();
	});

	it("garde l'empreinte Battle.net sans le BattleTag", async () => {
		const { service, prisma } = makeService({ battlenet: 1 });

		const result = await service.erase(USER_ID, USER_ID, ACTOR);

		expect(prisma.battlenetAccount.updateMany).toHaveBeenCalledWith({
			where: { userId: USER_ID },
			data: { battletag: null },
		});
		expect(result.kept.battlenetLinks).toBe(1);
		expect(result.userRemoved).toBe(false);
		// Sans bannissement, la presence part quand meme.
		expect(prisma.member.deleteMany).toHaveBeenCalled();
	});
});
