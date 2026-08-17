import { DEFAULT_MODERATION_POINTS } from "@anubis/shared";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { ModerationPointsService } from "./moderation-points.service";

const ACTOR = { id: "app-1" } as AuthenticatedUser;

const ROW = {
	guildId: "guild-1",
	warningLowPoints: 2,
	warningMediumPoints: 4,
	warningHighPoints: 8,
	timeoutPoints: 6,
	kickPoints: 9,
	banPoints: 20,
	shadowbanPoints: 7,
	warnThreshold: 10,
	criticalThreshold: 25,
	updatedAt: new Date("2026-08-17T10:00:00.000Z"),
};

function makeService(row: typeof ROW | null) {
	const prisma = {
		moderationPointsConfig: {
			findUnique: jest.fn().mockResolvedValue(row),
			upsert: jest.fn().mockImplementation(({ create, update }) =>
				Promise.resolve({ ...ROW, ...create, ...update }),
			),
		},
	} as unknown as PrismaService;

	const guild = { guildId: "guild-1" } as unknown as GuildContextService;
	const audit = {
		record: jest.fn().mockResolvedValue(undefined),
	} as unknown as AuditService;

	return { service: new ModerationPointsService(prisma, guild, audit), prisma, audit };
}

describe("ModerationPointsService", () => {
	it("renvoie le bareme par defaut tant que rien n'a ete regle", async () => {
		const { service } = makeService(null);
		const config = await service.getConfig();

		expect(config.warningPoints).toEqual(DEFAULT_MODERATION_POINTS.warningPoints);
		expect(config.sanctionPoints).toEqual(DEFAULT_MODERATION_POINTS.sanctionPoints);
		// Epoch : afficher la date du jour ferait croire a un reglage existant.
		expect(config.updatedAt).toBe(new Date(0).toISOString());
	});

	it("expose les colonnes de la base en dictionnaires indexes par l'enum", async () => {
		const { service } = makeService(ROW);
		const config = await service.getConfig();

		expect(config.warningPoints).toEqual({ LOW: 2, MEDIUM: 4, HIGH: 8 });
		expect(config.sanctionPoints).toEqual({
			TIMEOUT: 6,
			KICK: 9,
			BAN: 20,
			SHADOWBAN: 7,
		});
	});

	it("donne les points par defaut d'un type de sanction et d'une gravite", async () => {
		const { service } = makeService(ROW);

		await expect(service.pointsForSanction("BAN")).resolves.toBe(20);
		await expect(service.pointsForWarning("MEDIUM")).resolves.toBe(4);
	});

	it("conserve les champs absents d'une mise a jour partielle", async () => {
		const { service, prisma } = makeService(ROW);

		await service.updateConfig({ sanctionPoints: { BAN: 30 } }, ACTOR);

		const upsert = (prisma.moderationPointsConfig.upsert as jest.Mock).mock
			.calls[0][0];
		expect(upsert.update.banPoints).toBe(30);
		// Le formulaire n'envoie que ce qui a change : le reste ne doit pas
		// retomber sur les valeurs par defaut.
		expect(upsert.update.kickPoints).toBe(ROW.kickPoints);
		expect(upsert.update.warningHighPoints).toBe(ROW.warningHighPoints);
		expect(upsert.update.criticalThreshold).toBe(ROW.criticalThreshold);
	});

	it("part du bareme par defaut quand la premiere ecriture cree la ligne", async () => {
		const { service, prisma } = makeService(null);

		await service.updateConfig({ warnThreshold: 4 }, ACTOR);

		const upsert = (prisma.moderationPointsConfig.upsert as jest.Mock).mock
			.calls[0][0];
		expect(upsert.create.warnThreshold).toBe(4);
		expect(upsert.create.banPoints).toBe(
			DEFAULT_MODERATION_POINTS.sanctionPoints.BAN,
		);
	});

	it("journalise le bareme resolu, pas le corps de la requete", async () => {
		const { service, audit } = makeService(ROW);

		await service.updateConfig({ sanctionPoints: { BAN: 30 } }, ACTOR);

		const entree = (audit.record as jest.Mock).mock.calls[0][0];
		expect(entree.action).toBe("moderation.points.update");
		// Sans cela, l'entree ne dirait pas ce qui n'a pas bouge.
		expect(entree.after.kickPoints).toBe(ROW.kickPoints);
		expect(entree.before.sanctionPoints.BAN).toBe(ROW.banPoints);
	});
});
