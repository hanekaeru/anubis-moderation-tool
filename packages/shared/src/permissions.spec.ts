import { AppUserRole } from "./enums";
import {
	OWNER_ONLY_PERMISSIONS,
	Permission,
	ROLE_RANK,
	STAFF_PERMISSIONS,
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

	// Ce que ADMIN herite est cumulatif : ajouter une permission a la matrice
	// sans y penser la distribuerait a tous les administrateurs. Ce test rend
	// l'oubli visible pour les droits qui ne doivent revenir qu'au proprietaire.
	it("n'accorde a ADMIN aucune permission reservee au proprietaire", () => {
		const admin = permissionsForRole(AppUserRole.ADMIN);

		for (const permission of OWNER_ONLY_PERMISSIONS) {
			expect(admin).not.toContain(permission);
		}
	});
});

// STAFF est une branche a part : rien ne l'ajoute automatiquement a la chaine
// VIEWER < MODERATOR < ADMIN, donc rien ne previent qu'une permission de
// moderation y glisse — sauf ce test.
describe("STAFF", () => {
	it("ne lit rien de la moderation, ni le wiki", () => {
		const interdites: Permission[] = [
			Permission.MEMBERS_READ,
			Permission.NOTES_READ,
			Permission.WARNINGS_READ,
			Permission.SANCTIONS_READ,
			Permission.TICKETS_READ,
			Permission.LOGS_READ,
			Permission.AUTOMOD_READ,
			Permission.RAID_READ,
			Permission.QUARANTINE_READ,
			Permission.ACCOUNT_FLAGS_READ,
			Permission.WIKI_READ,
			Permission.STATS_READ,
			Permission.EMBEDS_WRITE,
		];
		for (const permission of interdites) {
			expect(STAFF_PERMISSIONS).not.toContain(permission);
		}
	});

	it("anime : mini-jeux, esport, concours, statut", () => {
		const staff = permissionsForRole(AppUserRole.STAFF);
		expect(staff).toContain(Permission.MINIGAMES_WRITE);
		expect(staff).toContain(Permission.ESPORT_WRITE);
		expect(staff).toContain(Permission.GIVEAWAY_WRITE);
		expect(staff).toContain(Permission.STATUS_READ);
		expect(staff).not.toContain(Permission.MINIGAMES_MANAGE);
	});

	it("est au rang de la lecture seule", () => {
		expect(ROLE_RANK.STAFF).toBe(ROLE_RANK.VIEWER);
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
