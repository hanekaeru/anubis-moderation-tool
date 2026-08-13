import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@anubis/shared";
import type { AuthenticatedUser } from "../types";
import { PermissionsGuard } from "./permissions.guard";

function contextWith(
	required: Permission[] | undefined,
	user: AuthenticatedUser | undefined,
): ExecutionContext {
	return {
		getHandler: () => ({}) as never,
		getClass: () => ({}) as never,
		switchToHttp: () => ({
			getRequest: () => ({ user }),
		}),
	} as unknown as ExecutionContext;
}

function guardWith(required: Permission[] | undefined) {
	const reflector = {
		getAllAndOverride: jest.fn().mockReturnValue(required),
	} as unknown as Reflector;
	return new PermissionsGuard(reflector);
}

describe("PermissionsGuard", () => {
	it("autorise quand aucune permission n'est requise", () => {
		const guard = guardWith(undefined);
		expect(guard.canActivate(contextWith(undefined, undefined))).toBe(true);
	});

	it("autorise quand la liste de permissions requises est vide", () => {
		const guard = guardWith([]);
		expect(guard.canActivate(contextWith([], undefined))).toBe(true);
	});

	it("refuse sans jeter quand aucun utilisateur n'est attache a la requete", () => {
		const guard = guardWith(["members:read" as Permission]);
		expect(
			guard.canActivate(contextWith(["members:read" as Permission], undefined)),
		).toBe(false);
	});

	it("autorise quand l'utilisateur possede toutes les permissions requises", () => {
		const guard = guardWith(["members:read" as Permission]);
		const user: AuthenticatedUser = {
			id: "1",
			username: "mod",
			displayName: "Mod",
			role: "MODERATOR",
			permissions: ["members:read" as Permission, "notes:read" as Permission],
			mustChangePassword: false,
		};

		expect(
			guard.canActivate(
				contextWith(["members:read" as Permission], user),
			),
		).toBe(true);
	});

	it("jette une ForbiddenException listant les permissions manquantes", () => {
		const guard = guardWith([
			"members:read" as Permission,
			"users:write" as Permission,
		]);
		const user: AuthenticatedUser = {
			id: "1",
			username: "mod",
			displayName: "Mod",
			role: "MODERATOR",
			permissions: ["members:read" as Permission],
			mustChangePassword: false,
		};

		expect(() =>
			guard.canActivate(
				contextWith(
					["members:read" as Permission, "users:write" as Permission],
					user,
				),
			),
		).toThrow(ForbiddenException);

		try {
			guard.canActivate(
				contextWith(
					["members:read" as Permission, "users:write" as Permission],
					user,
				),
			);
		} catch (error) {
			expect((error as ForbiddenException).message).toContain("users:write");
		}
	});
});
