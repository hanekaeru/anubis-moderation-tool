import { BadRequestException, ConflictException } from "@nestjs/common";
import { OWDLE_DEFAULT_XP_BY_GUESSES } from "@anubis/shared";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import type { CreateOwdleHeroDto } from "./dto/owdle.dto";
import { OwdleService } from "./owdle.service";

const GUILD_ID = "1534550360180396132";

const ACTOR = {
	id: "00000000-0000-0000-0000-000000000001",
	displayName: "Moderatrice",
} as unknown as AuthenticatedUser;

const AFFILIATIONS = [
	{ key: "overwatch", label: "Overwatch" },
	{ key: "none", label: "Aucune" },
];

function heroRow(overrides: Record<string, unknown> = {}) {
	const row = {
		key: "lucio",
		name: "Lúcio",
		role: "SUPPORT",
		subRole: "TACTICIAN",
		species: "HUMAN",
		origin: "Brésil",
		region: "AMERICAS",
		affiliationKey: "overwatch",
		releaseYear: 2016,
		enabled: true,
		createdAt: new Date("2026-11-02T10:00:00.000Z"),
		updatedAt: new Date("2026-11-02T10:00:00.000Z"),
		...overrides,
	};
	return { ...row, affiliation: AFFILIATIONS.find((a) => a.key === row.affiliationKey)! };
}

function makeService(options: { heroes?: ReturnType<typeof heroRow>[]; config?: unknown } = {}) {
	const heroes = options.heroes ?? [heroRow()];
	const compte = (key: string) => heroes.filter((h) => h.affiliationKey === key).length;
	const prisma = {
		owdleHero: {
			findMany: jest.fn().mockResolvedValue(heroes),
			findUnique: jest.fn().mockImplementation(({ where }) =>
				Promise.resolve(heroes.find((h) => h.key === where.key) ?? null),
			),
			count: jest.fn().mockImplementation(({ where }) =>
				Promise.resolve(heroes.filter((h) => h.enabled === where.enabled).length),
			),
			create: jest.fn().mockImplementation(({ data }) => Promise.resolve(heroRow(data))),
			update: jest.fn().mockImplementation(({ where, data }) =>
				Promise.resolve(heroRow({ ...heroes.find((h) => h.key === where.key), ...data })),
			),
		},
		owdleAffiliation: {
			findMany: jest.fn().mockResolvedValue(
				AFFILIATIONS.map((a) => ({ ...a, _count: { heroes: compte(a.key) } })),
			),
			findUnique: jest.fn().mockImplementation(({ where }) =>
				Promise.resolve(AFFILIATIONS.find((a) => a.key === where.key) ?? null),
			),
			create: jest.fn().mockResolvedValue(undefined),
			update: jest.fn().mockResolvedValue(undefined),
			delete: jest.fn().mockResolvedValue(undefined),
		},
		owdleConfig: {
			findUnique: jest.fn().mockResolvedValue(options.config ?? null),
			upsert: jest.fn().mockImplementation(({ create }) =>
				Promise.resolve({ ...create, updatedAt: new Date() }),
			),
		},
	} as unknown as PrismaService;

	const guild = { guildId: GUILD_ID } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return { service: new OwdleService(prisma, guild, audit), prisma };
}

const nouveau: CreateOwdleHeroDto = {
	key: "nouveau",
	name: "Nouveau",
	role: "TANK",
	subRole: "BRUISER",
	species: "HUMAN",
	origin: "France",
	region: "EUROPE",
	affiliationKey: "none",
	releaseYear: 2027,
};

describe("OwdleService.overview", () => {
	it("donne le bareme par defaut quand rien n'est regle", async () => {
		const { service } = makeService();
		const overview = await service.overview();

		expect(overview.config.xpByGuesses).toEqual([...OWDLE_DEFAULT_XP_BY_GUESSES]);
		expect(overview.heroes.map((h) => h.affiliation)).toEqual([
			{ key: "overwatch", label: "Overwatch" },
		]);
		expect(overview.affiliations).toEqual([
			{ key: "none", label: "Aucune", heroCount: 0 },
			{ key: "overwatch", label: "Overwatch", heroCount: 1 },
		]);
	});
});

describe("OwdleService.createHero", () => {
	it("refuse un sous-role d'un autre role", async () => {
		const { service } = makeService();

		await expect(
			service.createHero({ ...nouveau, subRole: "MEDIC" }, ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("refuse une affiliation absente de la liste", async () => {
		const { service } = makeService();

		await expect(
			service.createHero({ ...nouveau, affiliationKey: "blackwatch" }, ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("refuse un nom que la saisie du joueur confondrait", async () => {
		const { service } = makeService();

		await expect(
			service.createHero({ ...nouveau, name: "Lucio" }, ACTOR),
		).rejects.toBeInstanceOf(ConflictException);
	});

	it("refuse une cle deja prise", async () => {
		const { service } = makeService();

		await expect(
			service.createHero({ ...nouveau, key: "lucio" }, ACTOR),
		).rejects.toBeInstanceOf(ConflictException);
	});

	it("enregistre un heros actif par defaut", async () => {
		const { service, prisma } = makeService();

		await service.createHero({ ...nouveau, name: "  Nouveau  " }, ACTOR);

		expect(prisma.owdleHero.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ key: "nouveau", name: "Nouveau", enabled: true }),
			}),
		);
	});
});

describe("OwdleService.updateHero", () => {
	// Changer le role seul laisserait un « Tank Tactique » : la coherence se
	// verifie sur la fiche complete, pas sur les seuls champs envoyes.
	it("verifie le sous-role contre le role existant", async () => {
		const { service } = makeService();

		await expect(service.updateHero("lucio", { role: "TANK" }, ACTOR)).rejects.toBeInstanceOf(
			BadRequestException,
		);
		await expect(
			service.updateHero("lucio", { role: "TANK", subRole: "STALWART" }, ACTOR),
		).resolves.toMatchObject({ role: "TANK", subRole: "STALWART" });
	});

	it("change d'affiliation dans la liste", async () => {
		const { service } = makeService();

		await expect(
			service.updateHero("lucio", { affiliationKey: "none" }, ACTOR),
		).resolves.toMatchObject({ affiliation: { key: "none", label: "Aucune" } });
		await expect(
			service.updateHero("lucio", { affiliationKey: "blackwatch" }, ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("refuse de desactiver le dernier heros actif", async () => {
		const { service } = makeService();

		await expect(service.updateHero("lucio", { enabled: false }, ACTOR)).rejects.toBeInstanceOf(
			BadRequestException,
		);
	});

	it("desactive un heros quand il en reste d'autres", async () => {
		const { service } = makeService({
			heroes: [heroRow(), heroRow({ key: "ana", name: "Ana" })],
		});

		await expect(service.updateHero("lucio", { enabled: false }, ACTOR)).resolves.toMatchObject({
			enabled: false,
		});
	});
});

describe("OwdleService affiliations", () => {
	it("tire la cle du libelle", async () => {
		const { service, prisma } = makeService();

		await expect(service.createAffiliation({ label: "  Gang Deadlock " }, ACTOR)).resolves.toEqual({
			key: "gang-deadlock",
			label: "Gang Deadlock",
			heroCount: 0,
		});
		expect(prisma.owdleAffiliation.create).toHaveBeenCalledWith({
			data: { key: "gang-deadlock", label: "Gang Deadlock" },
		});
	});

	// La cle d'un libelle renomme reste prise : la nouvelle doit s'en departager.
	it("departage une cle deja prise", async () => {
		const { service } = makeService();

		await expect(service.createAffiliation({ label: "None" }, ACTOR)).resolves.toMatchObject({
			key: "none-2",
		});
	});

	it("refuse un libelle qui ne differe que par la casse ou les accents", async () => {
		const { service } = makeService();

		await expect(service.createAffiliation({ label: "overwatch" }, ACTOR)).rejects.toBeInstanceOf(
			ConflictException,
		);
		await expect(
			service.renameAffiliation("none", { label: "OVERWATCH" }, ACTOR),
		).rejects.toBeInstanceOf(ConflictException);
	});

	it("renomme sans toucher a la cle", async () => {
		const { service, prisma } = makeService();

		await service.renameAffiliation("overwatch", { label: "Overwatch (Blackwatch)" }, ACTOR);

		expect(prisma.owdleAffiliation.update).toHaveBeenCalledWith({
			where: { key: "overwatch" },
			data: { label: "Overwatch (Blackwatch)" },
		});
	});

	it("refuse de supprimer une affiliation portee par un heros", async () => {
		const { service, prisma } = makeService();

		await expect(service.removeAffiliation("overwatch", ACTOR)).rejects.toBeInstanceOf(
			ConflictException,
		);
		await service.removeAffiliation("none", ACTOR);
		expect(prisma.owdleAffiliation.delete).toHaveBeenCalledWith({ where: { key: "none" } });
	});
});

describe("OwdleService.updateConfig", () => {
	it("cree la ligne avec le bareme recu", async () => {
		const { service, prisma } = makeService();

		await service.updateConfig({ xpByGuesses: [50, 0] }, ACTOR);

		expect(prisma.owdleConfig.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				create: { guildId: GUILD_ID, channelId: null, xpByGuesses: [50, 0] },
			}),
		);
	});
});
