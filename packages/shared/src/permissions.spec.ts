import { AppUserRole } from "./enums";
import {
	Permission,
	ROLE_RANK,
	permissionsForRole,
	roleHasPermission,
} from "./permissions";

describe("permissionsForRole", () => {
	it("etend VIEWER par MODERATOR", () => {
		const viewer = permissionsForRole(AppUserRole.VIEWER);
		const moderator = permissionsForRole(AppUserRole.MODERATOR);

		for (const permission of viewer) {
			expect(moderator).toContain(permission);
		}
		expect(moderator.length).toBeGreaterThan(viewer.length);
	});

	it("etend MODERATOR par ADMIN", () => {
		const moderator = permissionsForRole(AppUserRole.MODERATOR);
		const admin = permissionsForRole(AppUserRole.ADMIN);

		for (const permission of moderator) {
			expect(admin).toContain(permission);
		}
		expect(admin.length).toBeGreaterThan(moderator.length);
	});

	it("OWNER possede toutes les permissions declarees", () => {
		const owner = permissionsForRole(AppUserRole.OWNER);
		expect(new Set(owner)).toEqual(new Set(Object.values(Permission)));
	});
});

describe("roleHasPermission", () => {
	it("vrai quand le role porte la permission", () => {
		expect(
			roleHasPermission(AppUserRole.MODERATOR, Permission.WARNINGS_WRITE),
		).toBe(true);
	});

	it("faux quand le role ne porte pas la permission", () => {
		expect(
			roleHasPermission(AppUserRole.VIEWER, Permission.WARNINGS_WRITE),
		).toBe(false);
	});
});

describe("ROLE_RANK", () => {
	it("est strictement croissant VIEWER < MODERATOR < ADMIN < OWNER", () => {
		expect(ROLE_RANK.VIEWER).toBeLessThan(ROLE_RANK.MODERATOR);
		expect(ROLE_RANK.MODERATOR).toBeLessThan(ROLE_RANK.ADMIN);
		expect(ROLE_RANK.ADMIN).toBeLessThan(ROLE_RANK.OWNER);
	});
});
