import { BadRequestException, Injectable } from "@nestjs/common";
import {
	AppUserRole,
	IMMUTABLE_ROLE,
	Permission,
	permissionsForRole,
	resolveRolePermissions,
	type RolePermissionOverride,
	type RolePermissionsMatrixDto,
	type RolePermissionsDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Permissions par role, reglables depuis le dashboard.
 *
 * La base ne stocke que les **ecarts** a la matrice livree avec le code
 * (`ROLE_PERMISSIONS`) : une permission ajoutee dans une version suivante
 * arrive ainsi d'elle-meme dans les roles qui la meritent, sans migration de
 * donnees ni ecran a re-cocher.
 *
 * Le role proprietaire est intouchable — c'est ce qui garantit qu'on ne peut
 * pas se verrouiller dehors en retirant `permissions:manage` a tout le monde.
 */

/**
 * Duree de vie du cache.
 *
 * Une invalidation explicite suit chaque ecriture ; ce delai n'existe que pour
 * le jour ou plusieurs instances d'API tourneront de front, chacune avec son
 * propre cache. Sans lui, une modification faite sur l'une resterait invisible
 * des autres jusqu'a leur redemarrage.
 */
const CACHE_TTL_MS = 30_000;

const VALID_PERMISSIONS = new Set<string>(Object.values(Permission));

@Injectable()
export class RolePermissionsService {
	private cache: { overrides: RolePermissionOverride[]; expiresAt: number } | null =
		null;

	constructor(
		private readonly prisma: PrismaService,
		private readonly audit: AuditService,
	) {}

	private async loadOverrides(): Promise<RolePermissionOverride[]> {
		if (this.cache && this.cache.expiresAt > Date.now()) {
			return this.cache.overrides;
		}

		const rows = await this.prisma.rolePermissionOverride.findMany();
		const overrides = rows.map((row) => ({
			role: row.role as AppUserRole,
			permission: row.permission as Permission,
			granted: row.granted,
		}));

		this.cache = { overrides, expiresAt: Date.now() + CACHE_TTL_MS };
		return overrides;
	}

	private invalidate(): void {
		this.cache = null;
	}

	/**
	 * Permissions effectives d'un role.
	 *
	 * Appelee a chaque requete authentifiee (`JwtStrategy`), d'ou le cache : une
	 * lecture de plus par requete pour un reglage qui bouge une fois par an
	 * serait payee mille fois pour rien.
	 */
	async resolve(role: AppUserRole): Promise<Permission[]> {
		return resolveRolePermissions(role, await this.loadOverrides());
	}

	async getMatrix(): Promise<RolePermissionsMatrixDto> {
		const overrides = await this.loadOverrides();

		const latest = await this.prisma.rolePermissionOverride.findFirst({
			orderBy: { updatedAt: "desc" },
			select: { updatedAt: true },
		});

		const roles: RolePermissionsDto[] = Object.values(AppUserRole).map((role) => ({
			role,
			permissions: resolveRolePermissions(role, overrides),
			defaults: [...permissionsForRole(role)],
			locked: role === IMMUTABLE_ROLE,
			overrideCount: overrides.filter((override) => override.role === role).length,
		}));

		return { roles, updatedAt: latest?.updatedAt.toISOString() ?? null };
	}

	/**
	 * Remplace la liste des permissions d'un role.
	 *
	 * L'appelant envoie l'etat voulu ; l'ecart avec les defauts en est deduit
	 * puis reecrit en bloc. Revenir exactement aux defauts efface donc toutes
	 * les lignes, et le role redevient suiveur des futures versions du code.
	 */
	async updateRole(
		role: AppUserRole,
		wanted: Permission[],
		actor: AuthenticatedUser,
	): Promise<RolePermissionsDto> {
		if (role === IMMUTABLE_ROLE) {
			throw new BadRequestException(
				"Le rôle propriétaire garde toutes les permissions et n'est pas modifiable.",
			);
		}

		const inconnues = wanted.filter((permission) => !VALID_PERMISSIONS.has(permission));
		if (inconnues.length) {
			throw new BadRequestException(
				`Permission inconnue : ${inconnues.join(", ")}.`,
			);
		}

		const voulues = new Set(wanted);
		const defauts = new Set(permissionsForRole(role));

		const ecarts = Object.values(Permission)
			.filter((permission) => voulues.has(permission) !== defauts.has(permission))
			.map((permission) => ({
				role,
				permission,
				granted: voulues.has(permission),
			}));

		const avant = await this.resolve(role);

		await this.prisma.$transaction([
			this.prisma.rolePermissionOverride.deleteMany({ where: { role } }),
			...ecarts.map((ecart) =>
				this.prisma.rolePermissionOverride.create({ data: ecart }),
			),
		]);

		this.invalidate();

		await this.audit.record({
			appUserId: actor.id,
			action: "role-permissions.update",
			entityType: "role",
			entityId: role,
			before: { permissions: avant },
			after: { permissions: [...voulues] },
		});

		const overrides = await this.loadOverrides();

		return {
			role,
			permissions: resolveRolePermissions(role, overrides),
			defaults: [...defauts],
			locked: false,
			overrideCount: ecarts.length,
		};
	}
}
