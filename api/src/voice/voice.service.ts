import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
	DEFAULT_VOICE_NAME_PATTERN,
	DEFAULT_VOICE_STATUS_PATTERN,
	MAX_VOICE_HUB_OPTIONS,
	type LiveVoiceChannelDto,
	type LiveVoiceDto,
	type VoiceHubDto,
	type VoiceHubPlatformDto,
	type VoiceHubRankDto,
	type VoiceOccupantDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type {
	CreateVoiceHubDto,
	CreateVoiceHubPlatformDto,
	CreateVoiceHubRankDto,
	UpdateVoiceHubDto,
	UpdateVoiceHubPlatformDto,
	UpdateVoiceHubRankDto,
} from "./dto/voice-hub.dto";

type RankRow = {
	id: string;
	label: string;
	emoji: string | null;
	categoryId: string;
	position: number;
};

type PlatformRow = {
	id: string;
	label: string;
	emoji: string | null;
	position: number;
};

/** Ligne `VoiceHub` accompagnee du compte de ses salons encore ouverts. */
type HubRow = {
	id: string;
	guildId: string;
	channelId: string | null;
	name: string;
	namePattern: string;
	statusPattern: string;
	userLimit: number;
	position: number;
	enabled: boolean;
	updatedAt: Date;
	ranks?: RankRow[];
	platforms?: PlatformRow[];
	_count?: { temporaryChannels: number };
};

/**
 * Tout ce qu'un `VoiceHubDto` complet demande de charger.
 *
 * Partage entre les quatre chemins qui renvoient un hub : oublier `ranks` sur
 * l'un d'eux ferait disparaitre les rangs du dashboard juste apres une
 * modification, sans que rien n'ait change en base.
 */
const HUB_INCLUDE = {
	ranks: { orderBy: { position: "asc" } },
	platforms: { orderBy: { position: "asc" } },
	_count: { select: { temporaryChannels: { where: { closedAt: null } } } },
} as const;

@Injectable()
export class VoiceService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	private toHubDto(row: HubRow): VoiceHubDto {
		return {
			id: row.id,
			guildId: row.guildId,
			channelId: row.channelId,
			name: row.name,
			namePattern: row.namePattern,
			statusPattern: row.statusPattern,
			userLimit: row.userLimit,
			position: row.position,
			enabled: row.enabled,
			ranks: (row.ranks ?? []).map((rank) => this.toRankDto(rank)),
			platforms: (row.platforms ?? []).map((platform) =>
				this.toPlatformDto(platform),
			),
			activeChannels: row._count?.temporaryChannels ?? 0,
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	private toRankDto(row: RankRow): VoiceHubRankDto {
		return {
			id: row.id,
			label: row.label,
			emoji: row.emoji,
			categoryId: row.categoryId,
			position: row.position,
		};
	}

	private toPlatformDto(row: PlatformRow): VoiceHubPlatformDto {
		return {
			id: row.id,
			label: row.label,
			emoji: row.emoji,
			position: row.position,
		};
	}

	async listHubs(): Promise<VoiceHubDto[]> {
		const rows = await this.prisma.voiceHub.findMany({
			where: { guildId: this.guild.guildId },
			orderBy: [{ position: "asc" }, { name: "asc" }],
			include: HUB_INCLUDE,
		});

		return rows.map((row) => this.toHubDto(row));
	}

	async createHub(
		dto: CreateVoiceHubDto,
		actor: AuthenticatedUser,
	): Promise<VoiceHubDto> {
		const created = await this.prisma.voiceHub.create({
			data: {
				guildId: this.guild.guildId,
				name: dto.name,
				namePattern: dto.namePattern ?? DEFAULT_VOICE_NAME_PATTERN,
				statusPattern: dto.statusPattern ?? DEFAULT_VOICE_STATUS_PATTERN,
				userLimit: dto.userLimit ?? 0,
				position: dto.position ?? 0,
				enabled: dto.enabled ?? true,
			},
			include: HUB_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "voice.hub.create",
			entityType: "voice_hub",
			entityId: created.id,
			after: { ...dto },
		});

		return this.toHubDto(created);
	}

	async updateHub(
		id: string,
		dto: UpdateVoiceHubDto,
		actor: AuthenticatedUser,
	): Promise<VoiceHubDto> {
		const existing = await this.prisma.voiceHub.findFirst({
			where: { id, guildId: this.guild.guildId },
		});
		if (!existing) throw new NotFoundException("Salon de création introuvable.");

		const updated = await this.prisma.voiceHub.update({
			where: { id },
			data: {
				...(dto.name !== undefined ? { name: dto.name } : {}),
				...(dto.namePattern !== undefined ? { namePattern: dto.namePattern } : {}),
				...(dto.statusPattern !== undefined
					? { statusPattern: dto.statusPattern }
					: {}),
				...(dto.userLimit !== undefined ? { userLimit: dto.userLimit } : {}),
				...(dto.position !== undefined ? { position: dto.position } : {}),
				...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
			},
			include: HUB_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "voice.hub.update",
			entityType: "voice_hub",
			entityId: id,
			before: { name: existing.name, enabled: existing.enabled },
			after: { ...dto },
		});

		return this.toHubDto(updated);
	}

	/**
	 * Retire un salon de creation de la liste.
	 *
	 * Le salon Discord, lui, reste en place : le supprimer depuis la webapp
	 * demanderait au bot de le faire, et `/delete_parties` couvre deja ce
	 * besoin. La reponse le signale a l'appelant plutot que de laisser croire
	 * que Discord a suivi.
	 */
	async deleteHub(
		id: string,
		actor: AuthenticatedUser,
	): Promise<{ channelId: string | null }> {
		const existing = await this.prisma.voiceHub.findFirst({
			where: { id, guildId: this.guild.guildId },
		});
		if (!existing) throw new NotFoundException("Salon de création introuvable.");

		// `TemporaryVoiceChannel` cascade sur le hub : supprimer maintenant
		// effacerait les lignes des salons encore ouverts, et le bot cesserait de
		// les reconnaitre — plus de panneau, plus de suppression automatique une
		// fois vides. Ils resteraient sur le serveur pour toujours.
		const ouverts = await this.prisma.temporaryVoiceChannel.count({
			where: { hubId: id, closedAt: null },
		});

		if (ouverts > 0) {
			throw new ConflictException(
				`${ouverts} salon(s) issu(s) de ce salon de création sont encore ouverts. ` +
					"Desactive-le et attends qu'ils se vident, ou lance /purge_vocaux sur Discord.",
			);
		}

		await this.prisma.voiceHub.delete({ where: { id } });

		await this.audit.record({
			appUserId: actor.id,
			action: "voice.hub.delete",
			entityType: "voice_hub",
			entityId: id,
			before: { name: existing.name, channelId: existing.channelId },
		});

		return { channelId: existing.channelId };
	}

	/**
	 * Retrouve un salon de creation du serveur courant.
	 *
	 * Les rangs et plateformes sont adresses par leur seul identifiant dans les
	 * URL : sans ce controle, un compte d'un autre serveur pourrait en modifier
	 * en connaissant un UUID.
	 */
	private async hubDuServeur(hubId: string) {
		const hub = await this.prisma.voiceHub.findFirst({
			where: { id: hubId, guildId: this.guild.guildId },
			select: { id: true, name: true },
		});
		if (!hub) throw new NotFoundException("Salon de création introuvable.");
		return hub;
	}

	async createRank(
		hubId: string,
		dto: CreateVoiceHubRankDto,
		actor: AuthenticatedUser,
	): Promise<VoiceHubRankDto> {
		const hub = await this.hubDuServeur(hubId);

		// Le select de la modale Discord plafonne a 25 options : au-dela, les
		// rangs en trop seraient invisibles cote Discord sans que le dashboard
		// ne le laisse deviner.
		const existants = await this.prisma.voiceHubRank.count({ where: { hubId } });
		if (existants >= MAX_VOICE_HUB_OPTIONS) {
			throw new ConflictException(
				`Un salon de création ne peut pas proposer plus de ${MAX_VOICE_HUB_OPTIONS} rangs.`,
			);
		}

		const created = await this.prisma.voiceHubRank.create({
			data: {
				hubId,
				label: dto.label,
				emoji: dto.emoji ?? null,
				categoryId: dto.categoryId,
				position: dto.position ?? existants,
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "voice.hub.rank.create",
			entityType: "voice_hub_rank",
			entityId: created.id,
			after: { hub: hub.name, ...dto },
		});

		return this.toRankDto(created);
	}

	async updateRank(
		hubId: string,
		rankId: string,
		dto: UpdateVoiceHubRankDto,
		actor: AuthenticatedUser,
	): Promise<VoiceHubRankDto> {
		await this.hubDuServeur(hubId);

		const existing = await this.prisma.voiceHubRank.findFirst({
			where: { id: rankId, hubId },
		});
		if (!existing) throw new NotFoundException("Rang introuvable.");

		const updated = await this.prisma.voiceHubRank.update({
			where: { id: rankId },
			data: {
				...(dto.label !== undefined ? { label: dto.label } : {}),
				...(dto.emoji !== undefined ? { emoji: dto.emoji ?? null } : {}),
				...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
				...(dto.position !== undefined ? { position: dto.position } : {}),
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "voice.hub.rank.update",
			entityType: "voice_hub_rank",
			entityId: rankId,
			before: { label: existing.label, categoryId: existing.categoryId },
			after: { ...dto },
		});

		return this.toRankDto(updated);
	}

	/**
	 * Retire un rang de la liste.
	 *
	 * Les salons qui le portent ne sont **pas** deplaces : leur `rankId` repasse
	 * a `null` (`ON DELETE SET NULL`) et ils restent la ou ils sont. Les
	 * renvoyer d'office dans la categorie de leur salon de creation
	 * deplacerait des conversations en cours pour un reglage de dashboard.
	 */
	async deleteRank(
		hubId: string,
		rankId: string,
		actor: AuthenticatedUser,
	): Promise<void> {
		await this.hubDuServeur(hubId);

		const existing = await this.prisma.voiceHubRank.findFirst({
			where: { id: rankId, hubId },
		});
		if (!existing) throw new NotFoundException("Rang introuvable.");

		await this.prisma.voiceHubRank.delete({ where: { id: rankId } });

		await this.audit.record({
			appUserId: actor.id,
			action: "voice.hub.rank.delete",
			entityType: "voice_hub_rank",
			entityId: rankId,
			before: { label: existing.label, categoryId: existing.categoryId },
		});
	}

	async createPlatform(
		hubId: string,
		dto: CreateVoiceHubPlatformDto,
		actor: AuthenticatedUser,
	): Promise<VoiceHubPlatformDto> {
		const hub = await this.hubDuServeur(hubId);

		const existants = await this.prisma.voiceHubPlatform.count({ where: { hubId } });
		if (existants >= MAX_VOICE_HUB_OPTIONS) {
			throw new ConflictException(
				`Un salon de création ne peut pas proposer plus de ${MAX_VOICE_HUB_OPTIONS} plateformes.`,
			);
		}

		const created = await this.prisma.voiceHubPlatform.create({
			data: {
				hubId,
				label: dto.label,
				emoji: dto.emoji ?? null,
				position: dto.position ?? existants,
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "voice.hub.platform.create",
			entityType: "voice_hub_platform",
			entityId: created.id,
			after: { hub: hub.name, ...dto },
		});

		return this.toPlatformDto(created);
	}

	async updatePlatform(
		hubId: string,
		platformId: string,
		dto: UpdateVoiceHubPlatformDto,
		actor: AuthenticatedUser,
	): Promise<VoiceHubPlatformDto> {
		await this.hubDuServeur(hubId);

		const existing = await this.prisma.voiceHubPlatform.findFirst({
			where: { id: platformId, hubId },
		});
		if (!existing) throw new NotFoundException("Plateforme introuvable.");

		const updated = await this.prisma.voiceHubPlatform.update({
			where: { id: platformId },
			data: {
				...(dto.label !== undefined ? { label: dto.label } : {}),
				...(dto.emoji !== undefined ? { emoji: dto.emoji ?? null } : {}),
				...(dto.position !== undefined ? { position: dto.position } : {}),
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "voice.hub.platform.update",
			entityType: "voice_hub_platform",
			entityId: platformId,
			before: { label: existing.label },
			after: { ...dto },
		});

		return this.toPlatformDto(updated);
	}

	async deletePlatform(
		hubId: string,
		platformId: string,
		actor: AuthenticatedUser,
	): Promise<void> {
		await this.hubDuServeur(hubId);

		const existing = await this.prisma.voiceHubPlatform.findFirst({
			where: { id: platformId, hubId },
		});
		if (!existing) throw new NotFoundException("Plateforme introuvable.");

		await this.prisma.voiceHubPlatform.delete({ where: { id: platformId } });

		await this.audit.record({
			appUserId: actor.id,
			action: "voice.hub.platform.delete",
			entityType: "voice_hub_platform",
			entityId: platformId,
			before: { label: existing.label },
		});
	}

	/**
	 * Vue en direct des salons vocaux occupes.
	 *
	 * Deduite des sessions vocales encore ouvertes plutot que d'une table
	 * d'etat a part : le bot les tient deja a jour a chaque mouvement et les
	 * remet a plat a son demarrage, si bien qu'il n'y a rien de plus a ecrire
	 * ni de second etat qui puisse diverger.
	 */
	async getLive(): Promise<LiveVoiceDto> {
		const guildId = this.guild.guildId;

		const [sessions, temporaires] = await Promise.all([
			this.prisma.voiceSession.findMany({
				where: { guildId, leftAt: null },
				orderBy: { joinedAt: "asc" },
				include: { user: true, channel: { select: { name: true } } },
			}),
			this.prisma.temporaryVoiceChannel.findMany({
				where: { guildId, closedAt: null },
				include: { hub: { select: { name: true } } },
			}),
		]);

		const parChannel = new Map<string, typeof sessions>();
		for (const session of sessions) {
			const groupe = parChannel.get(session.channelId) ?? [];
			groupe.push(session);
			parChannel.set(session.channelId, groupe);
		}

		const temporairesParChannel = new Map(
			temporaires.map((salon) => [salon.channelId, salon]),
		);

		const channels: LiveVoiceChannelDto[] = [];

		for (const [channelId, occupants] of parChannel) {
			const temporaire = temporairesParChannel.get(channelId);
			const premier = occupants[0];
			if (!premier) continue;

			const liste: VoiceOccupantDto[] = occupants.map((session) => ({
				userId: session.userId,
				username: session.user.username,
				displayName: session.user.globalName,
				avatarUrl: session.user.avatarUrl,
				joinedAt: session.joinedAt.toISOString(),
				owner: temporaire?.ownerId === session.userId,
			}));

			channels.push({
				channelId,
				name: temporaire?.name ?? premier.channel?.name ?? channelId,
				temporary: temporaire !== undefined,
				hubName: temporaire?.hub.name ?? null,
				locked: temporaire?.locked ?? false,
				occupantCount: liste.length,
				occupants: liste,
				since: (temporaire?.createdAt ?? premier.joinedAt).toISOString(),
			});
		}

		// Les salons les plus peuples d'abord : c'est la ou un probleme se voit.
		channels.sort(
			(a, b) => b.occupantCount - a.occupantCount || a.name.localeCompare(b.name),
		);

		return {
			channels,
			totalOccupants: sessions.length,
			temporaryChannels: temporaires.length,
			checkedAt: new Date().toISOString(),
		};
	}
}
