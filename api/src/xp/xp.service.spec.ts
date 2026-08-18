import { BadRequestException } from "@nestjs/common";
import { XpAnnouncementMode } from "@anubis/shared";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { XpService } from "./xp.service";

const GUILD_ID = "1534550360180396132";
const CHANNEL_ID = "1534550360180396133";

const ACTOR = {
	id: "00000000-0000-0000-0000-000000000001",
	displayName: "Moderatrice",
} as unknown as AuthenticatedUser;

function configRow(overrides: Record<string, unknown> = {}) {
	return {
		guildId: GUILD_ID,
		mode: XpAnnouncementMode.CURRENT_CHANNEL,
		channelId: null,
		message: null,
		pingMember: true,
		updatedAt: new Date("2026-08-18T10:00:00.000Z"),
		...overrides,
	};
}

function makeService(existing: Record<string, unknown> | null = null) {
	const prisma = {
		xpConfig: {
			findUnique: jest.fn().mockResolvedValue(existing),
			// L'upsert renvoie ce qu'on lui demande d'ecrire : le service ne fait
			// que le remettre en forme.
			upsert: jest.fn().mockImplementation(({ create }) =>
				Promise.resolve(configRow(create)),
			),
		},
	} as unknown as PrismaService;

	const guild = { guildId: GUILD_ID } as unknown as GuildContextService;
	const audit = {
		record: jest.fn().mockResolvedValue(undefined),
	} as unknown as AuditService;

	return { service: new XpService(prisma, guild, audit), prisma, audit };
}

describe("XpService.getConfig", () => {
	// Un serveur qui n'a jamais ouvert la page doit garder le comportement
	// d'origine : l'absence de ligne ne vaut pas « pas d'annonce ».
	it("renvoie le comportement historique quand rien n'est enregistre", async () => {
		const { service } = makeService();
		const config = await service.getConfig();

		expect(config.mode).toBe(XpAnnouncementMode.CURRENT_CHANNEL);
		expect(config.channelId).toBeNull();
		expect(config.message).toBeNull();
		expect(config.pingMember).toBe(true);
	});
});

describe("XpService.updateConfig", () => {
	it("refuse le salon dedie sans salon", async () => {
		const { service } = makeService();

		await expect(
			service.updateConfig(
				{ mode: XpAnnouncementMode.DEDICATED_CHANNEL },
				ACTOR,
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	// Le salon peut avoir ete enregistre au tour precedent : seul le couple
	// final compte, pas ce que porte cette requete-ci.
	it("accepte le salon dedie quand le salon est deja enregistre", async () => {
		const { service } = makeService(configRow({ channelId: CHANNEL_ID }));

		const saved = await service.updateConfig(
			{ mode: XpAnnouncementMode.DEDICATED_CHANNEL },
			ACTOR,
		);

		expect(saved.mode).toBe(XpAnnouncementMode.DEDICATED_CHANNEL);
	});

	it("refuse de detacher le salon d'un mode qui l'exige", async () => {
		const { service } = makeService(
			configRow({
				mode: XpAnnouncementMode.DEDICATED_CHANNEL,
				channelId: CHANNEL_ID,
			}),
		);

		await expect(
			service.updateConfig({ channelId: null }, ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("journalise la modification", async () => {
		const { service, audit } = makeService();

		await service.updateConfig(
			{ mode: XpAnnouncementMode.DIRECT_MESSAGE, pingMember: false },
			ACTOR,
		);

		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ action: "xp.config.update", entityId: GUILD_ID }),
		);
	});
});
