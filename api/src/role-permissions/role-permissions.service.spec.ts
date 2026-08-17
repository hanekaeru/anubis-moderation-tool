import { BadRequestException } from "@nestjs/common";
import { Permission, permissionsForRole } from "@anubis/shared";
import type { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types";
import type { PrismaService } from "../prisma/prisma.service";
import { RolePermissionsService } from "./role-permissions.service";

const ACTOR = { id: "00000000-0000-0000-0000-000000000001" } as AuthenticatedUser;

function makeService(overrides: unknown[] = []) {
	const prisma = {
		rolePermissionOverride: {
			findMany: jest.fn().mockResolvedValue(overrides),
			findFirst: jest.fn().mockResolvedValue(null),
			deleteMany: jest.fn(),
			create: jest.fn(),
		},
		$transaction: jest.fn().mockResolvedValue([]),
	} as unknown as PrismaService;

	const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

	return { service: new RolePermissionsService(prisma, audit), prisma, audit };
}

describe("RolePermissionsService.resolve", () => {
	it("renvoie les defauts du code quand rien n'est personnalise", async () => {
		const { service } = makeService();

		expect(await service.resolve("VIEWER")).toEqual([
			...permissionsForRole("VIEWER"),
		]);
	});

	it("ajoute une permission accordee et retire une permission revoquee", async () => {
		const { service } = makeService([
			{ role: "VIEWER", permission: Permission.WARNINGS_WRITE, granted: true },
			{ role: "VIEWER", permission: Permission.STATS_READ, granted: false },
		]);

		const permissions = await service.resolve("VIEWER");

		expect(permissions).toContain(Permission.WARNINGS_WRITE);
		expect(permissions).not.toContain(Permission.STATS_READ);
	});

	it("ignore les ecarts destines a un autre role", async () => {
		const { service } = makeService([
			{ role: "MODERATOR", permission: Permission.USERS_WRITE, granted: true },
		]);

		expect(await service.resolve("VIEWER")).not.toContain(Permission.USERS_WRITE);
	});

	it("garde toutes les permissions au proprietaire malgre un ecart enregistre", async () => {
		// Le garde-fou anti-verrouillage : meme une ligne en base ne doit pas
		// pouvoir retirer quoi que ce soit au role proprietaire.
		const { service } = makeService([
			{ role: "OWNER", permission: Permission.PERMISSIONS_MANAGE, granted: false },
		]);

		expect(await service.resolve("OWNER")).toEqual(Object.values(Permission));
	});

	it("ne relit pas la base a chaque appel", async () => {
		const { service, prisma } = makeService();

		await service.resolve("VIEWER");
		await service.resolve("MODERATOR");
		await service.resolve("ADMIN");

		expect(prisma.rolePermissionOverride.findMany).toHaveBeenCalledTimes(1);
	});
});

describe("RolePermissionsService.updateRole", () => {
	it("refuse de modifier le role proprietaire", async () => {
		const { service } = makeService();

		await expect(
			service.updateRole("OWNER", [Permission.STATS_READ], ACTOR),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("n'enregistre que les ecarts, pas la liste complete", async () => {
		const { service, prisma } = makeService();
		const defauts = permissionsForRole("VIEWER");

		await service.updateRole(
			"VIEWER",
			[...defauts, Permission.WARNINGS_WRITE],
			ACTOR,
		);

		// Une seule ligne : la permission ajoutee. Les defauts restent implicites,
		// pour qu'une future version du code puisse les faire evoluer.
		expect(prisma.rolePermissionOverride.create).toHaveBeenCalledTimes(1);
		expect(prisma.rolePermissionOverride.create).toHaveBeenCalledWith({
			data: { role: "VIEWER", permission: Permission.WARNINGS_WRITE, granted: true },
		});
	});

	it("n'ecrit aucune ligne quand on revient exactement aux defauts", async () => {
		const { service, prisma } = makeService([
			{ role: "VIEWER", permission: Permission.WARNINGS_WRITE, granted: true },
		]);

		await service.updateRole("VIEWER", [...permissionsForRole("VIEWER")], ACTOR);

		expect(prisma.rolePermissionOverride.deleteMany).toHaveBeenCalledWith({
			where: { role: "VIEWER" },
		});
		expect(prisma.rolePermissionOverride.create).not.toHaveBeenCalled();
	});

	it("journalise le changement", async () => {
		const { service, audit } = makeService();

		await service.updateRole("VIEWER", [Permission.STATS_READ], ACTOR);

		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "role-permissions.update",
				entityId: "VIEWER",
			}),
		);
	});
});

describe("RolePermissionsService.getMatrix", () => {
	it("marque le role proprietaire comme verrouille et compte les ecarts", async () => {
		const { service } = makeService([
			{ role: "VIEWER", permission: Permission.WARNINGS_WRITE, granted: true },
		]);

		const matrice = await service.getMatrix();
		const viewer = matrice.roles.find((row) => row.role === "VIEWER");
		const owner = matrice.roles.find((row) => row.role === "OWNER");

		expect(viewer?.overrideCount).toBe(1);
		expect(viewer?.locked).toBe(false);
		expect(owner?.locked).toBe(true);
	});
});
