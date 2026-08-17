import {
	BadRequestException,
	NotFoundException,
	PayloadTooLargeException,
} from "@nestjs/common";
import { MAX_MODERATION_ATTACHMENTS } from "@anubis/shared";
import type { AuditService } from "../audit/audit.service";
import type { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { ModerationAttachmentsService } from "./moderation-attachments.service";

const GUILD_ID = "1534867404755177634";
const ACTOR = { id: "app-1" } as AuthenticatedUser;

function fichier(overrides: Partial<Express.Multer.File> = {}) {
	return {
		originalname: "capture.png",
		mimetype: "image/png",
		size: 1024,
		buffer: Buffer.from("des octets"),
		...overrides,
	} as Express.Multer.File;
}

interface Options {
	cibleExiste?: boolean;
	dejaPresentes?: number;
	attachment?: unknown;
}

function makeService({
	cibleExiste = true,
	dejaPresentes = 0,
	attachment = null,
}: Options = {}) {
	const created = {
		id: "att-1",
		fileName: "capture.png",
		contentType: "image/png",
		size: 1024,
		spoiler: false,
		createdAt: new Date("2026-08-16T10:00:00.000Z"),
		uploadedBy: { id: "app-1", displayName: "Moderateur", username: "mod" },
		uploadedByDiscord: null,
	};

	const prisma = {
		sanction: {
			findFirst: jest.fn().mockResolvedValue(cibleExiste ? { id: "s-1" } : null),
		},
		warning: {
			findFirst: jest.fn().mockResolvedValue(cibleExiste ? { id: "w-1" } : null),
		},
		moderationAttachment: {
			findMany: jest.fn().mockResolvedValue([created]),
			findFirst: jest.fn().mockResolvedValue(attachment),
			count: jest.fn().mockResolvedValue(dejaPresentes),
			create: jest.fn().mockResolvedValue(created),
			delete: jest.fn().mockResolvedValue(undefined),
		},
	} as unknown as PrismaService;

	const guild = { guildId: GUILD_ID } as unknown as GuildContextService;
	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return {
		service: new ModerationAttachmentsService(prisma, guild, audit),
		prisma,
		audit,
	};
}

describe("ModerationAttachmentsService.upload", () => {
	it("rattache le fichier a la sanction et journalise le depot", async () => {
		const { service, prisma, audit } = makeService();

		const ref = await service.upload("sanction", "s-1", fichier(), ACTOR);

		expect(prisma.moderationAttachment.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ sanctionId: "s-1", contentType: "image/png" }),
			}),
		);
		expect(ref.uploadedBy?.label).toBe("Moderateur");
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ action: "sanction.attachment.add" }),
		);
	});

	it("laisse la piece visible par defaut et la marque quand le depot le demande", async () => {
		// Le marqueur est le seul rempart entre une preuve penible et l'ecran
		// d'un moderateur : il doit venir du depot, jamais d'une valeur par
		// defaut qui masquerait tout ou ne masquerait rien.
		const { service, prisma } = makeService();

		await service.upload("sanction", "s-1", fichier(), ACTOR);
		expect(prisma.moderationAttachment.create).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ spoiler: false }),
			}),
		);

		await service.upload("sanction", "s-1", fichier(), ACTOR, true);
		expect(prisma.moderationAttachment.create).toHaveBeenLastCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ spoiler: true }),
			}),
		);
	});

	it("rattache a la colonne avertissement quand la cible est un avertissement", async () => {
		// La table est partagee : se tromper de colonne rattacherait la preuve a
		// la mauvaise decision sans qu'aucune contrainte ne s'y oppose.
		const { service, prisma } = makeService();

		await service.upload("warning", "w-1", fichier(), ACTOR);

		expect(prisma.moderationAttachment.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ warningId: "w-1" }),
			}),
		);
	});

	it("refuse une cible qui n'existe pas sur ce serveur", async () => {
		const { service } = makeService({ cibleExiste: false });

		await expect(
			service.upload("sanction", "s-1", fichier(), ACTOR),
		).rejects.toBeInstanceOf(NotFoundException);
	});

	it("refuse une requete sans fichier", async () => {
		const { service } = makeService();

		await expect(
			service.upload("sanction", "s-1", undefined, ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("refuse un fichier au-dela du plafond", async () => {
		const { service } = makeService();

		await expect(
			service.upload("sanction", "s-1", fichier({ size: 30 * 1024 * 1024 }), ACTOR),
		).rejects.toBeInstanceOf(PayloadTooLargeException);
	});

	it("refuse un type non liste, notamment le HTML", async () => {
		// Le fichier est reservi tel quel : un text/html deposerait un script
		// executable sur le domaine du dashboard.
		const { service } = makeService();

		await expect(
			service.upload(
				"sanction",
				"s-1",
				fichier({ mimetype: "text/html", originalname: "piege.html" }),
				ACTOR,
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("refuse au-dela du nombre maximum de pieces jointes", async () => {
		const { service } = makeService({ dejaPresentes: MAX_MODERATION_ATTACHMENTS });

		await expect(
			service.upload("sanction", "s-1", fichier(), ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});
});

describe("ModerationAttachmentsService.download", () => {
	it("ne sert pas une piece jointe rattachee a une autre decision", async () => {
		// `findFirst` porte les deux conditions : sans le rattachement, un
		// identifiant devine donnerait acces a la preuve d'une autre sanction.
		const { service, prisma } = makeService({ attachment: null });

		await expect(
			service.download("sanction", "s-1", "att-2"),
		).rejects.toBeInstanceOf(NotFoundException);

		expect(prisma.moderationAttachment.findFirst).toHaveBeenCalledWith({
			where: { id: "att-2", sanctionId: "s-1" },
		});
	});
});

describe("ModerationAttachmentsService.remove", () => {
	it("supprime la piece jointe et journalise ce qui a disparu", async () => {
		const { service, prisma, audit } = makeService({
			attachment: {
				id: "att-1",
				fileName: "capture.png",
				size: 1024,
			},
		});

		await service.remove("sanction", "s-1", "att-1", ACTOR);

		expect(prisma.moderationAttachment.delete).toHaveBeenCalledWith({
			where: { id: "att-1" },
		});
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "sanction.attachment.remove",
				before: expect.objectContaining({ fileName: "capture.png" }),
			}),
		);
	});
});
