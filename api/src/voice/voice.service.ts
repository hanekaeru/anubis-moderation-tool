import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
	DEFAULT_VOICE_NAME_PATTERN,
	type LiveVoiceChannelDto,
	type LiveVoiceDto,
	type VoiceHubDto,
	type VoiceOccupantDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateVoiceHubDto, UpdateVoiceHubDto } from "./dto/voice-hub.dto";

/** Ligne `VoiceHub` accompagnee du compte de ses salons encore ouverts. */
type HubRow = {
	id: string;
	guildId: string;
	channelId: string | null;
	name: string;
	namePattern: string;
	userLimit: number;
	position: number;
	enabled: boolean;
	updatedAt: Date;
	_count?: { temporaryChannels: number };
};

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
			userLimit: row.userLimit,
			position: row.position,
			enabled: row.enabled,
			activeChannels: row._count?.temporaryChannels ?? 0,
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	async listHubs(): Promise<VoiceHubDto[]> {
		const rows = await this.prisma.voiceHub.findMany({
			where: { guildId: this.guild.guildId },
			orderBy: [{ position: "asc" }, { name: "asc" }],
			include: {
				_count: { select: { temporaryChannels: { where: { closedAt: null } } } },
			},
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
				userLimit: dto.userLimit ?? 0,
				position: dto.position ?? 0,
				enabled: dto.enabled ?? true,
			},
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
				...(dto.userLimit !== undefined ? { userLimit: dto.userLimit } : {}),
				...(dto.position !== undefined ? { position: dto.position } : {}),
				...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
			},
			include: {
				_count: { select: { temporaryChannels: { where: { closedAt: null } } } },
			},
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
