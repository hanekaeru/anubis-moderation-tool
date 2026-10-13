import { BadRequestException } from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { WelcomeService } from "./welcome.service";

const GUILD_ID = "1534550360180396132";
const CHANNEL_ID = "1539001325478486026";
const ROLE_ID = "1539001325478486099";

const ACTOR = { id: "app-1", permissions: [] } as unknown as AuthenticatedUser;

function makeService(options: { existing?: Record<string, unknown> | null; config?: Record<string, string> } = {}) {
	const upsert = jest.fn().mockImplementation(({ create, update }) =>
		Promise.resolve({
			...create,
			...(options.existing ? { ...options.existing, ...update } : {}),
			updatedAt: new Date(0),
		}),
	);
	const config = options.config ?? {};
	const prisma = {
		welcomeConfig: {
			findUnique: jest.fn().mockResolvedValue(options.existing ?? null),
			upsert,
		},
		configGuild: {
			findUnique: jest.fn().mockImplementation(({ where }) => {
				const nom = where.guildId_configName.configName as string;
				return Promise.resolve(nom in config ? { configValue: config[nom] } : null);
			}),
		},
	} as unknown as PrismaService;

	const guild = { guildId: GUILD_ID } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return { service: new WelcomeService(prisma, guild, audit), upsert };
}

describe("WelcomeService.getConfig", () => {
	// Un serveur qui n'ouvre jamais la page ne doit voir aucun message apparaitre.
	it("renvoie tout coupe quand rien n'est enregistre", async () => {
		const { service } = makeService();
		const config = await service.getConfig();

		expect(config).toMatchObject({
			channelId: null,
			joinEnabled: false,
			leaveEnabled: false,
			boostEnabled: false,
			updatedAt: null,
		});
	});

	it("expose le role que {moderation} interpelle", async () => {
		const { service } = makeService({
			config: { ALERT_MENTION_ROLE: "MOD_ROLE", MOD_ROLE: ROLE_ID },
		});

		expect((await service.getConfig()).alertRoleId).toBe(ROLE_ID);
	});

	it("ignore une cle de role inconnue", async () => {
		const { service } = makeService({ config: { ALERT_MENTION_ROLE: "ROLE_INVENTE" } });

		expect((await service.getConfig()).alertRoleId).toBeNull();
	});
});

describe("WelcomeService.updateConfig", () => {
	it("refuse d'activer les arrivees sans salon", async () => {
		const { service, upsert } = makeService();

		await expect(service.updateConfig({ joinEnabled: true }, ACTOR)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		expect(upsert).not.toHaveBeenCalled();
	});

	// Le salon des arrivees sert de repli aux annonces de boost.
	it("accepte le boost sans salon dedie quand celui des arrivees existe", async () => {
		const { service, upsert } = makeService();

		await service.updateConfig({ channelId: CHANNEL_ID, boostEnabled: true }, ACTOR);

		expect(upsert).toHaveBeenCalled();
	});

	it("tient compte du salon deja enregistre", async () => {
		const { service, upsert } = makeService({
			existing: { guildId: GUILD_ID, channelId: CHANNEL_ID, joinEnabled: false },
		});

		await service.updateConfig({ joinEnabled: true }, ACTOR);

		expect(upsert.mock.calls[0]![0].update).toEqual({ joinEnabled: true });
	});

	// Une zone de texte videe veut dire « revenir au texte par defaut », pas
	// « envoyer un message vide », que Discord refuserait.
	it("remet le texte par defaut quand le gabarit est vide", async () => {
		const { service, upsert } = makeService();

		await service.updateConfig({ joinMessage: "   " }, ACTOR);

		expect(upsert.mock.calls[0]![0].update).toEqual({ joinMessage: null });
	});
});
