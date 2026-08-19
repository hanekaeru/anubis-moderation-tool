import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
	DEFAULT_QUARANTINE_BATTLENET_BUTTON_LABEL,
	DEFAULT_QUARANTINE_BUTTON_LABEL,
	Permission,
	QuarantineStage,
	quarantineStage,
	type QuarantineConfigDto,
	type QuarantineStatusDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import type { AppConfig } from "../config/configuration";
import { PrismaService } from "../prisma/prisma.service";
import type { UpdateQuarantineConfigDto } from "./dto/quarantine.dto";

const DEFAULTS = {
	enabled: false,
	roleId: null as string | null,
	channelId: null as string | null,
	message: null as string | null,
	buttonLabel: DEFAULT_QUARANTINE_BUTTON_LABEL,
	releaseAddRoleIds: [] as string[],
	releaseRemoveRoleIds: [] as string[],
	acceptAddRoleIds: [] as string[],
	acceptRemoveRoleIds: [] as string[],
	verifyAddRoleIds: [] as string[],
	verifyRemoveRoleIds: [] as string[],
	battlenetRequired: false,
	battlenetButtonLabel: DEFAULT_QUARANTINE_BATTLENET_BUTTON_LABEL,
	battlenetMessage: null as string | null,
};

/**
 * Colonnes de reglage recopiees telles quelles entre la base et le DTO.
 *
 * Enumerees une fois plutot que repetees dans `getConfig`, `updateConfig` et le
 * retour : la liste a triple a l'arrivee des roles par etape, et trois copies
 * d'un `...(dto.x !== undefined ? { x: dto.x } : {})` par champ laissaient
 * facilement un reglage lisible mais non enregistrable.
 */
const CHAMPS_CONFIG = [
	"enabled",
	"roleId",
	"channelId",
	"message",
	"buttonLabel",
	"releaseAddRoleIds",
	"releaseRemoveRoleIds",
	"acceptAddRoleIds",
	"acceptRemoveRoleIds",
	"verifyAddRoleIds",
	"verifyRemoveRoleIds",
	"battlenetRequired",
	"battlenetButtonLabel",
	"battlenetMessage",
] as const;

/** Ligne de `quarantine_status` avec ce qu'il faut pour l'afficher. */
type StatusRow = {
	guildId: string;
	userId: string;
	quarantinedAt: Date;
	acceptedAt: Date | null;
	battlenetVerifiedAt: Date | null;
	releasedById: string | null;
	discordSyncedAt: Date | null;
	user: {
		username: string;
		globalName: string | null;
		avatarUrl: string | null;
		battlenetAccount: { battletag: string } | null;
	};
	releasedBy: { displayName: string } | null;
};

@Injectable()
export class QuarantineService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
		private readonly config: ConfigService<{ app: AppConfig }, true>,
	) {}

	/** Lu a chaque reponse : la valeur vient de l'environnement, pas de la base. */
	private get battlenetAvailable(): boolean {
		return this.config.get("app", { infer: true }).battlenet.available;
	}

	async getConfig(): Promise<QuarantineConfigDto> {
		const guildId = this.guild.guildId;
		const existing = await this.prisma.quarantineConfig.findUnique({
			where: { guildId },
		});

		if (!existing) {
			return {
				guildId,
				...DEFAULTS,
				battlenetAvailable: this.battlenetAvailable,
				updatedAt: new Date(0).toISOString(),
			};
		}

		return this.toConfigDto(existing);
	}

	private toConfigDto(
		row: Record<string, unknown> & { guildId: string; updatedAt: Date },
	): QuarantineConfigDto {
		const dto: Record<string, unknown> = { guildId: row.guildId };
		for (const champ of CHAMPS_CONFIG) dto[champ] = row[champ];
		dto.battlenetAvailable = this.battlenetAvailable;
		dto.updatedAt = row.updatedAt.toISOString();
		return dto as unknown as QuarantineConfigDto;
	}

	async updateConfig(
		dto: UpdateQuarantineConfigDto,
		actor: AuthenticatedUser,
	): Promise<QuarantineConfigDto> {
		const guildId = this.guild.guildId;

		// Listes remplacees en bloc, jamais fusionnees : envoyer `[]` est le seul
		// moyen de vider un reglage, et une absorption partielle laisserait un role
		// retire du dashboard continuer a etre pose par le bot.
		const update: Record<string, unknown> = {};
		const create: Record<string, unknown> = { guildId };

		for (const champ of CHAMPS_CONFIG) {
			const valeur = (dto as Record<string, unknown>)[champ];
			if (valeur !== undefined) update[champ] = valeur;
			create[champ] = valeur ?? DEFAULTS[champ];
		}

		const saved = await this.prisma.quarantineConfig.upsert({
			where: { guildId },
			update,
			create: create as never,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "quarantine.config.update",
			entityType: "quarantine_config",
			entityId: guildId,
			after: { ...dto },
		});

		return this.toConfigDto(saved);
	}

	/**
	 * `battlenetRequired` est lu une fois par appel et passe a chaque ligne :
	 * c'est lui qui decide si une acceptation seule suffit a liberer, et le
	 * dashboard doit lire exactement la meme chose que le bot.
	 */
	private toStatusDto(
		row: StatusRow,
		battlenetRequired: boolean,
		voitLeBattletag: boolean,
	): QuarantineStatusDto {
		const stage = quarantineStage(row, battlenetRequired);
		const libere = stage === QuarantineStage.CLEARED;

		return {
			guildId: row.guildId,
			userId: row.userId,
			username: row.user.username,
			displayName: row.user.globalName,
			avatarUrl: row.user.avatarUrl,
			quarantinedAt: row.quarantinedAt.toISOString(),
			acceptedAt: row.acceptedAt?.toISOString() ?? null,
			battlenetVerifiedAt: row.battlenetVerifiedAt?.toISOString() ?? null,
			// Le fait d'avoir franchi l'etape reste lisible par toute l'equipe ;
			// l'identite Blizzard, non.
			battletag: voitLeBattletag
				? (row.user.battlenetAccount?.battletag ?? null)
				: null,
			releasedBy: row.releasedBy?.displayName ?? null,
			active: !libere,
			pendingSync: libere && row.discordSyncedAt === null,
		};
	}

	/**
	 * Membres actuellement bloques, du plus ancien au plus recent : c'est celui
	 * qui attend depuis le plus longtemps qui merite l'attention du staff.
	 *
	 * Le filtre ne peut plus se faire en base sur `acceptedAt: null` seul : avec
	 * la verification Battle.net, un membre ayant accepte le reglement est
	 * toujours bloque. La requete degrossit (une ligne acceptee **et**
	 * synchronisee n'a plus rien a raconter), `quarantineStage` tranche ensuite.
	 */
	async listActive(actor: AuthenticatedUser): Promise<QuarantineStatusDto[]> {
		const guildId = this.guild.guildId;

		const config = await this.prisma.quarantineConfig.findUnique({
			where: { guildId },
			select: { battlenetRequired: true },
		});

		const rows = await this.prisma.quarantineStatus.findMany({
			where: {
				guildId,
				OR: [{ acceptedAt: null }, { discordSyncedAt: null }],
			},
			orderBy: { quarantinedAt: "asc" },
			include: {
				user: { include: { battlenetAccount: true } },
				releasedBy: true,
			},
		});

		const battlenetRequired = config?.battlenetRequired ?? false;
		const voitLeBattletag = actor.permissions.includes(Permission.BATTLENET_READ);

		return rows
			.map((row) => this.toStatusDto(row, battlenetRequired, voitLeBattletag))
			.filter((dto) => dto.active || dto.pendingSync);
	}

	/**
	 * Levee manuelle depuis la webapp.
	 *
	 * `discordSyncedAt` reste a `null` : le retrait du role revient au bot, au
	 * prochain passage de sa tache de synchronisation. Idempotent, comme
	 * `RaidService.resolve` — relever une quarantaine deja levee ne doit pas
	 * echouer ni reprogrammer un retrait de role.
	 *
	 * `releasedById` fait foi a lui seul : une levee prononcee a la main passe
	 * outre la verification Battle.net, y compris quand elle est exigee. C'est
	 * exactement ce que le bouton sert a faire — debloquer quelqu'un pour qui la
	 * verification ne peut pas aboutir. `acceptedAt` est pose s'il manquait, pour
	 * que la chronologie garde une date de sortie de quarantaine.
	 */
	async release(
		userId: string,
		actor: AuthenticatedUser,
	): Promise<QuarantineStatusDto> {
		const guildId = this.guild.guildId;

		const config = await this.prisma.quarantineConfig.findUnique({
			where: { guildId },
			select: { battlenetRequired: true },
		});
		const battlenetRequired = config?.battlenetRequired ?? false;
		const voitLeBattletag = actor.permissions.includes(Permission.BATTLENET_READ);

		const include = {
			user: { include: { battlenetAccount: true } },
			releasedBy: true,
		} as const;

		const existing = await this.prisma.quarantineStatus.findUnique({
			where: { guildId_userId: { guildId, userId } },
			include,
		});

		if (!existing) throw new NotFoundException("Membre non mis en quarantaine.");

		if (
			quarantineStage(existing, battlenetRequired) === QuarantineStage.CLEARED
		) {
			return this.toStatusDto(existing, battlenetRequired, voitLeBattletag);
		}

		const updated = await this.prisma.quarantineStatus.update({
			where: { guildId_userId: { guildId, userId } },
			data: {
				acceptedAt: existing.acceptedAt ?? new Date(),
				releasedById: actor.id,
				discordSyncedAt: null,
			},
			include,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "quarantine.release",
			entityType: "quarantine_status",
			entityId: userId,
		});

		return this.toStatusDto(updated, battlenetRequired, voitLeBattletag);
	}
}
