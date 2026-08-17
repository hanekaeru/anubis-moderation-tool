import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@anubis/shared/prisma";
import type { RevokeSessionsResponse, SessionDto } from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { TokenService } from "../auth/token.service";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type { SessionQueryDto } from "./dto/session.dto";

const SESSION_INCLUDE = {
	appUser: {
		select: { id: true, username: true, displayName: true, role: true },
	},
} satisfies Prisma.RefreshTokenInclude;

type TokenRow = Prisma.RefreshTokenGetPayload<{ include: typeof SESSION_INCLUDE }>;

/**
 * Sessions ouvertes sur le dashboard.
 *
 * Une session est une **famille** de refresh tokens, pas un jeton : la rotation
 * en cree un nouveau a chaque rafraichissement, et les lister un par un
 * afficherait des dizaines de lignes pour un seul navigateur. La famille est ce
 * qu'on ouvre en se connectant et ce qu'on ferme en se deconnectant.
 *
 * La session de l'appelant est reconnue par `actor.sessionId`, porte par
 * l'access token : le cookie de refresh est limite au chemin `/api/auth` et
 * n'arrive jamais jusqu'ici.
 */
@Injectable()
export class SessionsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tokens: TokenService,
		private readonly audit: AuditService,
	) {}

	async list(
		query: SessionQueryDto,
		actor: AuthenticatedUser,
	): Promise<SessionDto[]> {
		const now = new Date();

		const where: Prisma.RefreshTokenWhereInput = {
			...(query.appUserId ? { appUserId: query.appUserId } : {}),
			// Par defaut, seules les sessions encore utilisables : une famille
			// entierement revoquee ou expiree n'est plus une session, c'est une
			// trace. Elle reste consultable a la demande, pour enqueter.
			...(query.includeInactive
				? {}
				: { revokedAt: null, expiresAt: { gt: now } }),
		};

		const rows = await this.prisma.refreshToken.findMany({
			where,
			include: SESSION_INCLUDE,
			orderBy: { issuedAt: "asc" },
		});

		return this.groupByFamily(rows, actor.sessionId ?? null);
	}

	/**
	 * Regroupe les jetons par famille.
	 *
	 * Les lignes arrivent triees par date d'emission croissante : la premiere
	 * porte l'ouverture de la session, la derniere son dernier signe de vie et
	 * le navigateur le plus recemment observe.
	 */
	private groupByFamily(rows: TokenRow[], currentFamily: string | null): SessionDto[] {
		const families = new Map<string, TokenRow[]>();

		for (const row of rows) {
			const existing = families.get(row.familyId);
			if (existing) existing.push(row);
			else families.set(row.familyId, [row]);
		}

		const sessions = [...families.entries()].map(([familyId, tokens]) => {
			const first = tokens[0]!;
			const last = tokens[tokens.length - 1]!;

			return {
				familyId,
				appUserId: last.appUserId,
				username: last.appUser.username,
				displayName: last.appUser.displayName,
				role: last.appUser.role,
				userAgent: last.userAgent,
				ip: last.ip,
				startedAt: first.issuedAt.toISOString(),
				lastSeenAt: last.issuedAt.toISOString(),
				expiresAt: last.expiresAt.toISOString(),
				rotationCount: tokens.length,
				current: familyId === currentFamily,
			} satisfies SessionDto;
		});

		return sessions.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
	}

	/**
	 * Ferme une session.
	 *
	 * Aucune regle de rang ici, a la difference de la gestion des comptes : le
	 * droit qui ouvre cette route n'est porte que par le proprietaire, et une
	 * session compromise doit pouvoir etre coupee quel que soit le compte qui la
	 * porte — y compris un autre proprietaire.
	 */
	async revoke(
		familyId: string,
		actor: AuthenticatedUser,
	): Promise<RevokeSessionsResponse> {
		// Se couper soi-meme depuis cette page ne rendrait pas la main
		// proprement : le cookie resterait pose et l'interface continuerait
		// d'afficher une session que le serveur a fermee. Le bouton « Se
		// deconnecter » de l'en-tete fait cela correctement.
		if (actor.sessionId && actor.sessionId === familyId) {
			throw new ForbiddenException(
				"Cette session est la vôtre : utilisez « Se déconnecter ».",
			);
		}

		const sample = await this.prisma.refreshToken.findFirst({
			where: { familyId },
			select: { appUserId: true },
		});

		if (!sample) throw new NotFoundException("Session introuvable.");

		const revoked = await this.tokens.revokeFamily(familyId);

		await this.audit.record({
			appUserId: actor.id,
			action: "session.revoke",
			entityType: "app_user",
			entityId: sample.appUserId,
			after: { familyId, revoked },
		});

		return { revoked };
	}

	/** Ferme toutes les sessions d'un compte, celle de l'appelant exceptee. */
	async revokeAllForUser(
		appUserId: string,
		actor: AuthenticatedUser,
	): Promise<RevokeSessionsResponse> {
		const { count } = await this.prisma.refreshToken.updateMany({
			where: {
				appUserId,
				revokedAt: null,
				...(actor.sessionId ? { familyId: { not: actor.sessionId } } : {}),
			},
			data: { revokedAt: new Date() },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "session.revoke_all",
			entityType: "app_user",
			entityId: appUserId,
			after: { revoked: count },
		});

		return { revoked: count };
	}
}
